variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "environment" {
  description = "dev, staging or prod."
  type        = string
}

variable "tags" {
  description = "Tags applied to every taggable resource."
  type        = map(string)
  default     = {}
}

variable "alarm_email_addresses" {
  description = <<-EOT
    Addresses subscribed to the alarm topic.

    FILL IN WHEN ACCESS LANDS. An alarm nobody receives is a dashboard.

    Each address gets a confirmation email that a human has to click. On the
    day of the flip, confirm them before the flip, not after.
  EOT
  type        = list(string)
  default     = []
}

variable "distribution_id" {
  description = "Apex CloudFront distribution id."
  type        = string
}

variable "media_distribution_id" {
  description = "Media CloudFront distribution id, or null. Used as an alarm dimension only, never in a count or a for_each: it is unknown until apply."
  type        = string
  default     = null
}

variable "media_distribution_enabled" {
  description = <<-EOT
    Whether a media distribution exists in this environment, so the media alarm
    can be counted from a value that is known at plan time.

    This is deliberately a separate flag rather than a null check on
    media_distribution_id. A distribution id is not known until apply, and a
    count that depends on an unknown value fails the plan outright.
  EOT
  type        = bool
  default     = false
}

variable "realtime_metrics_enabled" {
  description = <<-EOT
    Whether CloudFront additional metrics are enabled on the distribution.

    CacheHitRate is an ADDITIONAL metric. Without the monitoring subscription it
    is never published to CloudWatch and the cache hit ratio alarm cannot exist.
    This variable is here so that a false value fails loudly at plan time rather
    than producing an alarm that sits in INSUFFICIENT_DATA forever and looks
    like silence meaning health.
  EOT
  type        = bool
  default     = true
}

variable "function_names" {
  description = "Map of function key to function name."
  type        = map(string)
  default     = {}
}

variable "table_names" {
  description = "Map of table key to table name."
  type        = map(string)
  default     = {}
}

variable "dlq_names" {
  description = "Map of queue key to dead letter queue name."
  type        = map(string)
  default     = {}
}

variable "stream_consumer_function_key" {
  description = "Which function key consumes the DynamoDB stream, for the iterator age alarm."
  type        = string
  default     = "rollup_consumer"
}

# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

variable "cache_hit_rate_threshold" {
  description = <<-EOT
    Percentage below which the cache hit ratio alarms.

    THIS ALARM IS NOT OPTIONAL. The Architecture document, section
    "Measurement", names a falling cache hit ratio as the earliest warning that
    something broke the rendering strategy, and the redirect-serving decision,
    section 6, failure mode 4, names it as the detection mechanism for cache
    key fragmentation: attribution parameters entering the cache key would turn
    cache hits into origin fetches silently, with no error, no 5xx, and no
    alert from anything else in this file.

    90 is a starting value on a pre-rendered site where nearly every request
    should be a hit. Tune it once there are three days of real numbers, and
    record the change rather than adjusting it quietly to stop a page.
  EOT
  type        = number
  default     = 90
}

variable "error_rate_threshold" {
  description = "Distribution 5xx error rate percentage that alarms."
  type        = number
  default     = 1
}

variable "client_error_rate_threshold" {
  description = <<-EOT
    Distribution 4xx error rate percentage that alarms.

    This is the MVP stand-in for the unknown-code alarm the Data model
    document, section 7.6, asks for: a spike in unknown /t/ codes means either
    a mis-encoded batch or a redirect table that lost a row, and both are worth
    being woken up for. A 4xx rate alarm catches the spike but not the code.

    TO CONFIRM: attributing an alarm to a specific unknown code needs CloudFront
    real-time logs to Kinesis Data Firehose plus a metric filter, which is a
    day-two item and is not provisioned here.
  EOT
  type        = number
  default     = 5
}

variable "iterator_age_threshold_ms" {
  description = "Stream iterator age in milliseconds that alarms. 5 minutes behind on a 5 second batching window is not a blip."
  type        = number
  default     = 300000
}

variable "treat_low_traffic_as_healthy" {
  description = <<-EOT
    How the rate alarms treat missing data.

    true (notBreaching) on dev and staging, where there is often no traffic at
    all and a percentage of nothing is not a number.

    On prod this is a real judgement, not a default. After launch, a
    distribution reporting NO requests is itself a symptom. The honest position
    is that a rate alarm cannot detect absence of traffic and should not
    pretend to, so absence is left to the soak review on Monday 24 August and
    to the field beacon, which counts real taps.
  EOT
  type        = bool
  default     = true
}
