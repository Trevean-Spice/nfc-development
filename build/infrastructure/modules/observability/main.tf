# ===========================================================================
# Alarms
#
# The Architecture document, section "Measurement", names four:
#
#   error rate, function failures, database throttling, and cache hit ratio
#
# and says of the last one: a falling cache hit ratio is the earliest warning
# that something broke the rendering strategy. That one is not optional and it
# is the one that would be dropped first if this list were ever trimmed,
# because it is the only alarm here that fires on a system that is returning
# 200s to everybody.
#
# One regional constraint that is easy to get wrong: CloudFront publishes its
# metrics to us-east-1 only, so a CloudFront alarm created in any other region
# watches a metric that never arrives and sits in INSUFFICIENT_DATA forever.
# This module must therefore be given a provider configured for us-east-1. The
# environments in envs/ all deploy to us-east-1 for that reason and because the
# ACM certificate has to live there anyway.
# ===========================================================================

locals {
  missing_data = var.treat_low_traffic_as_healthy ? "notBreaching" : "missing"
}

resource "aws_sns_topic" "alarms" {
  name = "${var.name_prefix}-alarms"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  for_each = toset(var.alarm_email_addresses)

  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = each.value
}

# ---------------------------------------------------------------------------
# 1. Cache hit ratio. The one that is not optional.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "cache_hit_rate" {
  count = var.realtime_metrics_enabled ? 1 : 0

  alarm_name = "${var.name_prefix}-cache-hit-rate-falling"

  alarm_description = join(" ", [
    "Cache hit ratio on the apex distribution has fallen below ${var.cache_hit_rate_threshold} percent.",
    "This is the earliest warning that something broke the rendering strategy.",
    "Three things produce it and none of them return an error to a customer:",
    "(1) attribution parameters entered the cache key and fragmented the cache per code,",
    "(2) blend pages started rendering on demand instead of ahead of time,",
    "(3) the render cache fell back to a local filesystem so every instance has its own copy.",
    "Check the cache policy for /blend.html first: the key is path plus blend only, and via and utm_* are excluded by design.",
  ])

  namespace           = "AWS/CloudFront"
  metric_name         = "CacheHitRate"
  statistic           = "Average"
  period              = 900
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = var.cache_hit_rate_threshold
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = local.missing_data

  dimensions = {
    DistributionId = var.distribution_id
    Region         = "Global"
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
  tags          = var.tags

  lifecycle {
    precondition {
      condition     = var.realtime_metrics_enabled
      error_message = "CacheHitRate is a CloudFront ADDITIONAL metric. Enable the monitoring subscription on the distribution, or this alarm sits in INSUFFICIENT_DATA forever and silence looks like health."
    }
  }
}

# ---------------------------------------------------------------------------
# 2. Error rate
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "error_rate_5xx" {
  alarm_name        = "${var.name_prefix}-distribution-5xx"
  alarm_description = "5xx error rate on the apex distribution is above ${var.error_rate_threshold} percent. On the tap path this is 1,000 encoded jars opening nothing."

  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = var.error_rate_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = local.missing_data

  dimensions = {
    DistributionId = var.distribution_id
    Region         = "Global"
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "error_rate_4xx" {
  alarm_name = "${var.name_prefix}-distribution-4xx"

  alarm_description = join(" ", [
    "4xx error rate on the apex distribution is above ${var.client_error_rate_threshold} percent.",
    "The case this exists for: a spike in unknown /t/ codes, which means either a mis-encoded batch or a redirect table that lost a row.",
    "Both strand physical inventory and neither shows up anywhere else.",
    "This alarm catches the spike but not the code. Read the access logs for the codes.",
  ])

  namespace           = "AWS/CloudFront"
  metric_name         = "4xxErrorRate"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = var.client_error_rate_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = local.missing_data

  dimensions = {
    DistributionId = var.distribution_id
    Region         = "Global"
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

# ---------------------------------------------------------------------------
# 3. Function failures
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "function_errors" {
  for_each = var.function_names

  alarm_name        = "${var.name_prefix}-${replace(each.key, "_", "-")}-errors"
  alarm_description = "Function ${each.value} is returning errors."

  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = each.key == "scan_ingest" ? 10 : 1
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

# The scan beacon has a deliberately looser threshold above, and it is worth
# one sentence of reasoning. A ConditionalCheckFailedException on the beacon
# write is a DUPLICATE, which is a success, not an error: the API returns 202
# for both and the client cannot tell the difference. If the function treats it
# correctly it never reaches this metric at all. A handful of real errors on the
# only function a customer's phone can invoke is still worth knowing about, so
# the threshold is loosened rather than removed.

resource "aws_cloudwatch_metric_alarm" "function_throttles" {
  for_each = var.function_names

  alarm_name        = "${var.name_prefix}-${replace(each.key, "_", "-")}-throttles"
  alarm_description = "Function ${each.value} is being throttled. On the tap path this is a lost measurement, not a failed page."

  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

# ---------------------------------------------------------------------------
# 4. DynamoDB throttling
#
# Throttling on the scan write is a SILENTLY LOST MEASUREMENT. The page is
# fine, the customer is fine, and the number that gates a contractual
# acceptance criterion is quietly wrong. On-demand capacity makes this
# unlikely; the alarm exists because the consequence is invisible.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "dynamodb_read_throttles" {
  for_each = var.table_names

  alarm_name        = "${var.name_prefix}-${replace(each.key, "_", "-")}-read-throttles"
  alarm_description = "Read throttling on ${each.value}."

  namespace           = "AWS/DynamoDB"
  metric_name         = "ReadThrottleEvents"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    TableName = each.value
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "dynamodb_write_throttles" {
  for_each = var.table_names

  alarm_name        = "${var.name_prefix}-${replace(each.key, "_", "-")}-write-throttles"
  alarm_description = "Write throttling on ${each.value}. On ScanEvents this is a silently lost measurement."

  namespace           = "AWS/DynamoDB"
  metric_name         = "WriteThrottleEvents"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    TableName = each.value
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "dynamodb_system_errors" {
  for_each = var.table_names

  alarm_name        = "${var.name_prefix}-${replace(each.key, "_", "-")}-system-errors"
  alarm_description = "DynamoDB system errors on ${each.value}."

  namespace           = "AWS/DynamoDB"
  metric_name         = "SystemErrors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    TableName = each.value
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

# ---------------------------------------------------------------------------
# 5. Stream consumer health
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "iterator_age" {
  count = contains(keys(var.function_names), var.stream_consumer_function_key) ? 1 : 0

  alarm_name        = "${var.name_prefix}-rollup-consumer-iterator-age"
  alarm_description = "The rollup consumer is falling behind the ScanEvents stream. The dashboard goes stale before anything visibly breaks."

  namespace           = "AWS/Lambda"
  metric_name         = "IteratorAge"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.iterator_age_threshold_ms
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = var.function_names[var.stream_consumer_function_key]
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "dlq_depth" {
  for_each = var.dlq_names

  alarm_name        = "${var.name_prefix}-${replace(each.key, "_", "-")}-dlq-depth"
  alarm_description = "Messages are sitting in ${each.value}. Bisect on error is disabled by design, so a poison batch lands here rather than blocking the shard. Somebody has to look."

  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = each.value
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

# ---------------------------------------------------------------------------
# 6. Media distribution
# ---------------------------------------------------------------------------

# count keys off media_distribution_enabled, NOT off media_distribution_id.
#
# media_distribution_id is a CloudFront distribution id that does not exist
# until apply, so on a first apply it is unknown at plan time. A count that
# depends on an unknown value is not a warning, it is "Invalid count argument"
# and the plan does not complete. That is a plan-time failure that terraform
# validate cannot see, on the first production apply, on a week with a hard DNS
# deadline. media_distribution_enabled comes from a variable, so it is always
# known, and the id is still used for the dimension where an unknown is fine.
resource "aws_cloudwatch_metric_alarm" "media_error_rate" {
  count = var.media_distribution_enabled ? 1 : 0

  alarm_name        = "${var.name_prefix}-media-distribution-5xx"
  alarm_description = "5xx error rate on the media distribution. Not on the tap path, but it is what the admin CMS shows an editor."

  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.error_rate_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DistributionId = var.media_distribution_id
    Region         = "Global"
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}
