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

# ---------------------------------------------------------------------------
# What the renderer runs as
# ---------------------------------------------------------------------------

variable "image_uri" {
  description = <<-EOT
    The container image the publish pipeline runs. Normally
    <account>.dkr.ecr.<region>.amazonaws.com/<name_prefix>-publisher:<tag>,
    pushed by build/publisher/scripts/push-image.sh into the repository this
    module creates.

    NULL IS A REAL STATE AND IT IS THE DEFAULT. With no image the service is
    created with a desired count of zero and the module publishes no
    revalidation URL, so the API keeps queueing publishes and dispatching
    nothing. That is the same failure it has today, reported the same honest
    way, rather than an API pointed at an endpoint with no healthy target
    behind it, which would turn every publish into a 503 the editor has to
    interpret.

    Terraform owns the service, its network and its permissions. The image
    pipeline owns the image, exactly as it owns the Lambda packages, which is
    why the task definition carries no lifecycle ignore and this is a variable
    rather than a build step.
  EOT
  type        = string
  default     = null
}

variable "task_role_arn" {
  description = <<-EOT
    The execution identity the container assumes. This is deliberately the
    SAME role the compute module already built for web_renderer: read the
    content tables, write the site bucket, invalidate the distribution, read
    the revalidation secret.

    The role and its permissions were settled before the host was. Creating a
    second role here would mean two answers to "what is the renderer allowed to
    do", and the one that is wrong would be the one nobody is reading.
  EOT
  type        = string
}

variable "task_cpu" {
  description = <<-EOT
    Fargate task CPU units. 1024 is one vCPU.

    THIS IS THE NUMBER THE FIVE MINUTE ACCEPTANCE CRITERION TURNS ON AND IT HAS
    NEVER BEEN MEASURED ON AWS. Read that literally before changing it. The
    render is a full Next export, it was measured at 165 to 203 seconds on eight
    cores of a laptop, and no render has ever run on a Fargate vCPU.

    What IS measured, in the container image on that laptop: 746 s on eight
    CPUs, 728 s on four, 741 s on two. THE SAME NUMBER TO WITHIN 2.5 PERCENT.
    Whatever that render is waiting on, it is not the core count. Two readings
    fit and they point different ways. Either the render is effectively single
    core, in which case paying for vCPUs buys nothing; or the container run is
    dominated by Docker Desktop for Windows's virtualised filesystem, in which
    case those numbers say nothing about Fargate at all. The experiment that
    separates them is running it on Fargate.

    SO THE DEFAULT IS SIZED FROM THE MEASUREMENT AND NOT FROM NERVES. 2048 is
    two vCPUs, it costs about $72 a month against $144 for four, and nothing
    measured suggests four would be faster. If the first real render comes back
    above about 250,000 ms, raise this to 4096 and measure again BEFORE changing
    anything else: if it does not move, the render is single core, the lever is
    the render rather than the host, and 4096 should be put straight back.

    See build/publisher's README, section 8.5, for the hour of work that closes
    this.

    Fargate accepts 256, 512, 1024, 2048, 4096, 8192 and 16384, and memory has
    to be a legal pairing for the value chosen.
  EOT
  type        = number
  default     = 2048

  validation {
    condition     = contains([1024, 2048, 4096, 8192, 16384], var.task_cpu)
    error_message = "task_cpu must be one of 1024, 2048, 4096, 8192, 16384. Values below 1024 cannot pair with the memory a Next export needs."
  }
}

variable "task_memory" {
  description = <<-EOT
    Fargate task memory in MiB. 4096 is the smallest legal pairing with 2048
    CPU units.

    It is headroom rather than a requirement. The render was observed holding
    222 MiB resident throughout in the container, so this is roughly eighteen
    times what it used. Fargate's pairing table decides it, not the workload:
    with 2048 CPU units the choice is 4096 through 16384, and there is nothing
    to gain above the floor.
  EOT
  type        = number
  default     = 4096
}

variable "desired_count" {
  description = <<-EOT
    How many tasks run. Zero or one, and never two.

    ONE, NOT TWO, AND IT IS A CORRECTNESS CONSTRAINT RATHER THAN A COST ONE.
    The publish pipeline reads the published manifest, diffs against it,
    puts the changed objects and writes the manifest back. Two tasks
    publishing concurrently interleave those steps and the manifest ends up
    describing neither publish, which makes the NEXT publish's diff wrong and
    invalidates the wrong paths. The deployment maximum percent below is what
    keeps a rolling deployment from briefly running two.

    Zero is forced when no image_uri is supplied.
  EOT
  type        = number
  default     = 1

  validation {
    condition     = var.desired_count == 0 || var.desired_count == 1
    error_message = "desired_count must be 0 or 1. Two publishers race on the published manifest."
  }
}

# ---------------------------------------------------------------------------
# What the container is told
# ---------------------------------------------------------------------------

variable "api_stage" {
  description = "STAGE, as the application reads it: staging or production. The placeholder deployment guard is gated on the exact string 'production' and the publisher refuses to start on an unrecognised value."
  type        = string
}

variable "site_bucket" {
  description = "The origin bucket rendered documents are published into. Bare name, not an ARN."
  type        = string
  default     = null
}

variable "distribution_id" {
  description = "The apex distribution to invalidate. Exactly the changed paths, never the distribution."
  type        = string
  default     = null
}

variable "public_base_url" {
  description = <<-EOT
    Where a published document is read back from to confirm it is live. The
    apex distribution's own hostname, because that is the host a tap reads and
    a confirmation taken from anywhere else confirms something a customer does
    not experience.

    Null means the pipeline publishes and invalidates and then reports
    "published, not confirmed" rather than claiming the page is live.
  EOT
  type        = string
  default     = null
}

variable "content_api_base_url" {
  description = <<-EOT
    The API the render reads, passed to the web build as TREVEAN_CONTENT_API.
    A base URL with no path: build/web's scripts/fetch-content.mjs appends
    /v1/blends and the rest.

    THIS IS THE VARIABLE THAT MAKES AN EDIT REACH A PAGE. The apex distribution
    is the correct value and modules/stack supplies it. Read the rest of this
    before changing it, because the reason it is safe is not obvious and it is
    not "CloudFront is fast enough".

    THE HAZARD, WHICH IS CLOSED IN CODE RATHER THAN AVOIDED HERE. /v1 content
    reads are cacheable at the edge: the frozen API contract, section 7, puts
    public, max-age=60, stale-while-revalidate=300 on them, and the cdn
    module's api_content policy honours it. So a render that reads through the
    distribution could be served a response cached BEFORE the edit it was
    dispatched to publish, render the previous version, and report success,
    because the read back compares the served page against what the renderer
    produced rather than against what the editor wrote. Coalescing made it more
    likely rather than less: a render takes about 200 seconds, so the second
    publish in an editing session reads a cache entry past max-age and inside
    stale-while-revalidate, which is exactly when a cache serves stale content.

    WHAT CLOSES IT, on Friday 4 September 2026. Every read the render makes
    carries a per render cache buster in the query string, and the api_content
    cache policy in modules/cdn sets query_string_behavior = "all" on both the
    cache key and the origin request, because on /v1 a query parameter selects
    the resource. A query string CloudFront has never seen cannot be a hit and
    cannot be inside stale-while-revalidate. The render then records what every
    response said about caches, and build/publisher refuses the publish before
    the guard, the diff, the put or the invalidation if any read cannot be shown
    to have come from the origin. The full argument, and the four rejected
    alternatives including reading DynamoDB directly, are in
    build/publisher/src/content-read.mjs.

    THAT MAKES THIS VARIABLE'S SAFETY DEPEND ON A POLICY IN modules/cdn. If
    api_content ever stops putting query strings in the cache key, or if
    something other than the apex distribution ends up in front of the API,
    publishes start FAILING with a message that names the stale reads. They do
    not start succeeding on stale bytes. That direction is the whole design.

    Null is still a legal value and still means the build renders the fixtures
    in build/content: the pages carry the placeholder markers, the deployment
    guard refuses them outright on production, and readiness reports
    render_reads_the_api = false.
  EOT
  type        = string
  default     = null
}

variable "revalidation_secret_name" {
  description = "Managed store name of the shared secret the dispatch signature is verified against. Absent on a deployed stage means every job is refused, never accepted."
  type        = string
}

variable "render_timeout_ms" {
  description = "How long the pipeline waits for the web build child process before killing it. Above the 300,000 ms contractual requirement on purpose: a render that has already lost the criterion should still finish and say so rather than disappear."
  type        = number
  default     = 420000
}

# ---------------------------------------------------------------------------
# Network and logs
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR for the small VPC this module creates. It holds one task and one load balancer and nothing else, so it is deliberately not shared with anything."
  type        = string
  default     = "10.60.0.0/16"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the container."
  type        = number
  default     = 30
}

variable "kms_key_arn" {
  description = "Customer managed key, for the log group."
  type        = string
  default     = null
}

variable "price_class" {
  description = "Price class for the small distribution that fronts the load balancer. PriceClass_100 is correct: this endpoint is called by one Lambda in one region and by whoever is looking at the admin publish screen, not by customers."
  type        = string
  default     = "PriceClass_100"
}
