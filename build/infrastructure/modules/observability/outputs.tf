output "alarm_topic_arn" {
  description = "SNS topic every alarm publishes to."
  value       = aws_sns_topic.alarms.arn
}

output "alarm_names" {
  description = "Every alarm created, so the soak review on Monday 24 August has a list to walk rather than a console to browse."
  value = sort(concat(
    var.realtime_metrics_enabled ? [aws_cloudwatch_metric_alarm.cache_hit_rate[0].alarm_name] : [],
    [aws_cloudwatch_metric_alarm.error_rate_5xx.alarm_name],
    [aws_cloudwatch_metric_alarm.error_rate_4xx.alarm_name],
    [for alarm in aws_cloudwatch_metric_alarm.function_errors : alarm.alarm_name],
    [for alarm in aws_cloudwatch_metric_alarm.function_throttles : alarm.alarm_name],
    [for alarm in aws_cloudwatch_metric_alarm.dynamodb_read_throttles : alarm.alarm_name],
    [for alarm in aws_cloudwatch_metric_alarm.dynamodb_write_throttles : alarm.alarm_name],
    [for alarm in aws_cloudwatch_metric_alarm.dynamodb_system_errors : alarm.alarm_name],
    [for alarm in aws_cloudwatch_metric_alarm.dlq_depth : alarm.alarm_name],
    [for alarm in aws_cloudwatch_metric_alarm.iterator_age : alarm.alarm_name],
    # Keyed off media_distribution_enabled, NOT media_distribution_id, so that
    # this predicate is the same one the resource's count uses. The id is a
    # CloudFront distribution id that is unknown until apply, and a guard here
    # that disagrees with the count in main.tf is how an index into a zero
    # length resource gets evaluated. See the note above the alarm itself.
    var.media_distribution_enabled ? [aws_cloudwatch_metric_alarm.media_error_rate[0].alarm_name] : [],
  ))
}

output "unconfirmed_subscriptions_warning" {
  description = "Reminder, not a value. Email subscriptions require a human to click a confirmation link. An unconfirmed subscription is an alarm nobody receives."
  value       = length(var.alarm_email_addresses) == 0 ? "NO ALARM RECIPIENTS CONFIGURED. Fill alarm_email_addresses when access lands." : "${length(var.alarm_email_addresses)} address(es) subscribed. Confirm each one before the flip, not after."
}
