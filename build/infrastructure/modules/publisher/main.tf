# ===========================================================================
# WHERE THE RENDERER RUNS
#
# Written Friday 4 September 2026. It closes the last open question in the
# publish path: build/publisher was built, tested and measured on Friday 4
# September 2026 at 199.3 seconds end to end against a 300 second contractual
# requirement, and then had nowhere to run, so revalidation_webhook_url stayed
# null and pressing publish queued a job, logged it, and dispatched nothing.
#
# THE ANSWER: ONE SMALL ALWAYS ON CONTAINER, on Fargate, behind a load balancer
# that only CloudFront can reach, fronted by its own small distribution so the
# apex distribution that 1,000 encoded jars resolve through is not touched at
# all.
#
# ---------------------------------------------------------------------------
# WHY, AND WHAT WAS REJECTED
#
# The render is `next build` in export mode plus the postbuild pass, run as a
# child process, because build/web's pipeline is the definition of what a blend
# page is and a second renderer would be a second definition. So the host has
# to give the pipeline three things: minutes of sustained CPU, a writable
# filesystem, and an installed Next dependency tree. Minutes, measured: 165 to
# 203 seconds on eight laptop cores, and never yet on a Fargate vCPU, which is
# the outstanding risk on M3 and is written up in build/publisher's README,
# section 8.5.
#
# It also has to fit the SHAPE the pipeline already has, and that turns out to
# decide it. Two facts about the existing code:
#
#   POST /revalidate answers 202 and does the work AFTER the response. It has
#   to: build/api's dispatch (src/services/revalidation.ts) carries a 2000 ms
#   AbortController. Anything that holds the connection for the length of a
#   render makes the API log a dispatch failure on every successful publish,
#   which is a lie in the log on the happy path.
#
#   GET /revalidations/{id} is served from an in-memory job store, and it is
#   the admin publish screen's stronger confirmation: the one that reports the
#   edge served the new document matched on sha256, next to the five minute
#   requirement.
#
# Both of those are properties of a long lived process.
#
#   A LAMBDA CONTAINER IMAGE. Rejected. 199 seconds does sit inside the 15
#   minute ceiling, /tmp is writable to 10 GB and the dependency tree bakes
#   into the image, so on paper it fits. It does not fit in practice for a
#   reason that has nothing to do with the timeout: Lambda FREEZES the
#   execution environment when the handler returns, so "202 now, render after"
#   cannot work, and the alternative, holding the request open for three
#   minutes, is the 2000 ms abort above. Making it work means inverting the
#   service into a front door plus an asynchronous worker plus a durable job
#   store to replace the in-memory one, which is a rewrite of server.mjs,
#   jobs.mjs and index.mjs in the week M3 is due, on a package with 33 passing
#   tests and a measured number against the contractual criterion. The timeout
#   was never the problem and raising it would have hidden this.
#
#   A FARGATE TASK RUN ON DEMAND. Rejected, and it is the most expensive of the
#   five in surface. RunTask has no HTTP endpoint, so revalidation_webhook_url
#   would still have nothing to point at and a front door would have to be
#   built anyway; the in-memory job store still has no address; and a task
#   launch costs an image pull and an ENI attachment, 30 to 60 seconds, before
#   any rendering starts, which comes straight out of the margin. It adds
#   everything the always on service adds and then adds a launch per publish.
#
#   A CI JOB TRIGGERED BY THE DISPATCH. Rejected on three counts. The API's
#   dispatch is an HMAC signed body with its own header and no CI provider
#   accepts that shape, so a shim would be needed regardless. It moves the
#   render, and with it the credential that writes the site bucket and
#   invalidates the CDN, out of the client's account and into a third party,
#   which is a larger security surface than any option here. And a hosted
#   runner is a cold checkout plus `npm ci` before a single page renders,
#   which is the one cold cost that is genuinely large.
#
#   ENQUEUE TO A BUILDER. Rejected as an answer, kept as a note. A queue does
#   not say where the render runs; it says how the render is reached, and the
#   builder at the other end is still one of the options above. It also adds
#   unbounded wait to a 300 second clock at a volume, a handful of publishes a
#   day, where the queue is empty every time. Its real value is coalescing
#   several publishes into one render, and that is implementable inside the
#   service that already holds the jobs.
#
#   APP RUNNER, which looks like the obvious small always on container and is
#   not. It allocates CPU only while a request is being processed, so work
#   after a 202 is throttled to nothing, and its request timeout is well below
#   a render. Both of the two things this workload needs are the two things it
#   does not do.
#
#   LIGHTSAIL CONTAINERS, cheaper and simpler than all of the above, rejected
#   on one fact: it has no task role. The renderer's credentials would have to
#   be static access keys in an environment variable, for an identity that can
#   write the origin 1,000 encoded jars resolve to.
#
# ---------------------------------------------------------------------------
# WHAT THIS COSTS, BECAUSE IT IS THE CLIENT'S ACCOUNT
#
# About $100 a month in us-east-1 at the default size, itemised so nobody has
# to reconstruct it:
#
#   $72   the task, 2 vCPU and 4 GiB, 730 hours
#   $17   the load balancer
#   $11   three public IPv4 addresses, two on the load balancer and one on the
#         task
#   ~$0   the image repository, the small distribution, the log group
#
# Four vCPUs would be $144 for the task instead of $72. See task_cpu in
# variables.tf for why the default is two and what would justify moving it.
#
# A LAMBDA WOULD HAVE BEEN ABOUT A DOLLAR A MONTH. That difference is real and
# it is recorded rather than buried: it buys a process that runs the publish
# pipeline exactly as it was written, tested and measured, instead of a rewrite
# of the one component whose whole job is to be trustworthy about whether a
# change is live, in the week M3 is due.
#
# create_publisher defaults to FALSE in all three environments. Nothing here
# appears on an invoice because somebody ran an apply.
# ===========================================================================

data "aws_region" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = "${var.name_prefix}-publisher"

  # No image means no service. See image_uri in variables.tf: an endpoint with
  # no healthy target behind it turns every publish into a 503 the editor has
  # to interpret, which is worse than the honest null this replaces.
  has_image     = var.image_uri != null
  desired_count = local.has_image ? var.desired_count : 0

  container_port = 3003

  # Load balancer and target group names are capped at 32 characters and may not
  # end in a hyphen. The dev name, "trevean-dev-" plus a nine-character suffix
  # plus "-publisher-tg", is 34, so a naive
  # substr to 32 produces a name ending in a hyphen and the apply fails on a
  # validation error that names neither the resource nor the length.
  alb_name = trimsuffix(substr(local.name, 0, 32), "-")
  tg_name  = "${trimsuffix(substr(local.name, 0, 29), "-")}-tg"

  # The two routes the load balancer forwards, and nothing else. An allowlist
  # rather than a prefix, because the service also has /health, which the
  # target group reaches from inside the VPC and which has no business being
  # answerable from the internet.
  routed_paths = ["/revalidate", "/revalidations/*"]

  environment = merge(
    {
      STAGE          = var.api_stage
      TREVEAN_ENV    = var.environment
      PUBLISH_TARGET = "s3"

      # 'build' and not 'prebuilt'. This is the mode that re-runs the web build
      # against the API before publishing, and it is the whole reason the
      # criterion is "content editable end to end" rather than "content
      # republishable".
      PUBLISHER_RENDER_MODE       = "build"
      PUBLISHER_RENDER_TIMEOUT_MS = tostring(var.render_timeout_ms)

      PUBLISHER_HOST = "0.0.0.0"
      PUBLISHER_PORT = tostring(local.container_port)

      REVALIDATION_SECRET_NAME = var.revalidation_secret_name
      AWS_REGION               = data.aws_region.current.name
    },
    var.site_bucket == null ? {} : { SITE_BUCKET = var.site_bucket },
    var.distribution_id == null ? {} : { CLOUDFRONT_DISTRIBUTION_ID = var.distribution_id },
    var.public_base_url == null ? {} : { PUBLISHER_PUBLIC_BASE_URL = var.public_base_url },
    var.content_api_base_url == null ? {} : { TREVEAN_CONTENT_API = var.content_api_base_url },
  )
}

# ---------------------------------------------------------------------------
# The image repository
#
# Immutable tags. A publish pipeline that can be changed under a tag that is
# already deployed is a pipeline whose behaviour cannot be reasoned about from
# the task definition, and this one holds the placeholder guard.
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "publisher" {
  name                 = local.name
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.environment == "dev"

  image_scanning_configuration {
    scan_on_push = true
  }

  # AES256 AND NOT THE ENVIRONMENT KEY, deliberately. A customer managed key on
  # a repository adds a KMS grant to create it and a kms:Decrypt on every pull,
  # for an artifact that holds no secret: it is this repository's own source and
  # a public Node base image. The secrets that matter are read from the managed
  # store at runtime by the task role and are never in the image. If this ever
  # carries something that has to be under the environment key, change this line
  # and add kms:Decrypt to the execution role below.
  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "publisher" {
  repository = aws_ecr_repository.publisher.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images. The running task pins a digest, so an older tag is only ever a rollback target."
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# ---------------------------------------------------------------------------
# A small VPC of its own
#
# Two public subnets because an Application Load Balancer requires two
# availability zones, and one task, which sits in the first of them.
#
# NO NAT GATEWAY, and that is a deliberate $32 a month. The task is given a
# public IP and placed in a public subnet, so it reaches ECR, S3, DynamoDB,
# Secrets Manager and CloudFront over the internet the same way a NAT gateway
# would have reached them. It is not REACHABLE from the internet: its security
# group has one ingress rule and the source is the load balancer's security
# group.
# ---------------------------------------------------------------------------

resource "aws_vpc" "publisher" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(var.tags, { Name = local.name })
}

resource "aws_internet_gateway" "publisher" {
  vpc_id = aws_vpc.publisher.id
  tags   = merge(var.tags, { Name = local.name })
}

resource "aws_subnet" "public" {
  count = 2

  vpc_id            = aws_vpc.publisher.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  # False, and the service asks for a public IP explicitly instead. A subnet
  # default is invisible at the point where it matters.
  map_public_ip_on_launch = false

  tags = merge(var.tags, { Name = "${local.name}-public-${count.index}" })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.publisher.id
  tags   = merge(var.tags, { Name = local.name })
}

resource "aws_route" "default" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.publisher.id
}

resource "aws_route_table_association" "public" {
  count = 2

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ---------------------------------------------------------------------------
# Security groups
#
# THE LOAD BALANCER IS INTERNET FACING AND ITS INGRESS IS NOT 0.0.0.0/0.
#
# It has to be internet facing because CloudFront reaches an origin over the
# public internet, and it is fronted by CloudFront because that is the only way
# to put TLS in front of this in an environment that has no domain name: dev
# and staging have no apex, and an ACM certificate cannot be issued for an
# *.elb.amazonaws.com name.
#
# So ingress is the CloudFront origin-facing managed prefix list and nothing
# else. That narrows the reachable set from the internet to CloudFront. It does
# not narrow it to THIS distribution, because a custom origin has no equivalent
# of the origin access control the S3 and function URL origins use, so any
# CloudFront distribution in any account can still reach this load balancer.
#
# WHAT ACTUALLY STOPS THAT REQUEST is the HMAC SHA-256 signature over the raw
# body, verified in constant time before the body is parsed, with a skew
# window. That gate is already built and tested. A caller who cannot produce
# the signature gets a 401 and no render. Stated here so nobody reads the
# prefix list as the security boundary: it is depth, and the signature is the
# gate.
# ---------------------------------------------------------------------------

data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Publish pipeline load balancer. Ingress from CloudFront only."
  vpc_id      = aws_vpc.publisher.id
  tags        = merge(var.tags, { Name = "${local.name}-alb" })
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "CloudFront edge locations only. See the note above: this is depth, the HMAC signature is the gate."
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id
}

resource "aws_vpc_security_group_egress_rule" "alb_to_task" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To the task, on the container port, and nowhere else."
  ip_protocol                  = "tcp"
  from_port                    = local.container_port
  to_port                      = local.container_port
  referenced_security_group_id = aws_security_group.task.id
}

resource "aws_security_group" "task" {
  name        = "${local.name}-task"
  description = "Publish pipeline task. Ingress from the load balancer only."
  vpc_id      = aws_vpc.publisher.id
  tags        = merge(var.tags, { Name = "${local.name}-task" })
}

resource "aws_vpc_security_group_ingress_rule" "task_from_alb" {
  security_group_id            = aws_security_group.task.id
  description                  = "The load balancer, on the container port. Nothing else can open a connection to this task."
  ip_protocol                  = "tcp"
  from_port                    = local.container_port
  to_port                      = local.container_port
  referenced_security_group_id = aws_security_group.alb.id
}

// Outbound to ECR, S3, DynamoDB, Secrets Manager, CloudFront and the content
// API. Unrestricted because the destination set is most of the public AWS
// endpoints, and an allowlist of them would be a list that silently goes stale.
//
// THE REASONING LIVES HERE RATHER THAN IN THE DESCRIPTION FIELD. EC2 rejects a
// security group rule description containing anything outside
// a-zA-Z0-9. _-:/()#,@[]+=&;{}!$* and an apostrophe is not in that set, so the
// possessive in "most of AWS's public endpoints" failed the apply with
// "InvalidParameterValue: Invalid rule description", which names neither the
// character nor the field. Observed on the first apply of the publisher,
// Monday 7 September 2026. Same family as the commas in tag values and the
// 128 character cap on a CloudFront policy comment: valid Terraform, valid
// plan, rejected by the API.
resource "aws_vpc_security_group_egress_rule" "task_all" {
  security_group_id = aws_security_group.task.id
  description       = "Outbound to AWS service endpoints and the content API. See the code comment."
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ---------------------------------------------------------------------------
# The load balancer
# ---------------------------------------------------------------------------

resource "aws_lb" "publisher" {
  name               = local.alb_name
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # The render is minutes long, but no request to this load balancer is: the
  # service answers 202 in milliseconds and renders afterwards. Sixty seconds
  # is generous for what actually crosses it and short enough that a wedged
  # connection does not sit there.
  idle_timeout = 60

  drop_invalid_header_fields = true
  tags                       = var.tags
}

resource "aws_lb_target_group" "publisher" {
  name        = local.tg_name
  port        = local.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.publisher.id

  # 30 seconds, because a task that has just started has to run the Node
  # process and nothing else. The container itself does not render on startup.
  health_check {
    enabled             = true
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # A publish that is in flight when a deployment replaces the task has already
  # answered 202 and is rendering, so draining the connection buys nothing and
  # holding the old task for five minutes delays the replacement. The publish
  # itself is retried from the admin.
  deregistration_delay = 30

  tags = var.tags
}

# The default action is a refusal, not the service. Every path except the two
# in local.routed_paths is answered by the load balancer and never reaches the
# container, which keeps /health off the internet.
resource "aws_lb_listener" "publisher" {
  load_balancer_arn = aws_lb.publisher.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "application/json"
      status_code  = "404"
      message_body = "{\"error\":{\"code\":\"NOT_FOUND\",\"message\":\"No route.\"}}"
    }
  }
}

resource "aws_lb_listener_rule" "publisher" {
  listener_arn = aws_lb_listener.publisher.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.publisher.arn
  }

  condition {
    path_pattern {
      values = local.routed_paths
    }
  }
}

# ---------------------------------------------------------------------------
# The distribution in front of it
#
# A SECOND, SMALL DISTRIBUTION AND NOT A BEHAVIOUR ON THE APEX ONE. Two
# reasons, and the first is the one that matters.
#
#   The apex distribution is the tap path. It is what 1,000 encoded jars
#   resolve through, its behaviour ORDER is load bearing in two places already,
#   and the Architecture document's three tap path rules are assertions about
#   it. Hanging a publish trigger off it puts a marketing tool's config
#   changes in the same blast radius as the redirect. This module does not
#   touch that distribution at all, so "the tap path is untouched" stays
#   literally true rather than needing a paragraph.
#
#   It breaks a Terraform cycle that would otherwise be real. build/api's
#   admin_api function needs REVALIDATION_WEBHOOK_URL, which is derived from
#   whatever fronts this load balancer. The apex distribution is already
#   downstream of the pooled Lambda functions, because two of them supply its
#   /v1 origins by function URL, and admin_api is in that same pool and
#   therefore the same Terraform resource node. Deriving its environment from
#   the apex distribution is the exact cycle documented beside
#   local.renderer_key in the compute module. This distribution depends only
#   on the load balancer, so there is no cycle and no second `moved` block.
#
# A distribution costs nothing at rest. At a handful of publishes a day the
# request charge is not measurable.
# ---------------------------------------------------------------------------

resource "aws_cloudfront_distribution" "publisher" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2"
  price_class     = var.price_class
  comment         = "${var.name_prefix} publish pipeline. Not on the tap path and not reachable by a customer."
  tags            = var.tags

  origin {
    origin_id   = "publisher-alb"
    domain_name = aws_lb.publisher.dns_name

    custom_origin_config {
      http_port  = 80
      https_port = 443

      # HTTP TO THE ORIGIN, AND THE RESIDUAL IS NAMED RATHER THAN GLOSSED.
      # Viewer to CloudFront is HTTPS. CloudFront to the load balancer is not,
      # because an ACM certificate cannot be issued for an *.elb.amazonaws.com
      # name and dev and staging have no domain to issue one for.
      #
      # What crosses that hop: a revalidation id, a list of content paths, an
      # optional reason, and an HMAC signature. No credential, no customer
      # data, no content. The signature is over the body, so an observer can
      # replay a publish of the same paths inside the skew window, which
      # re-renders identical bytes, finds nothing changed in the diff and
      # invalidates nothing.
      #
      # Closing it costs one hostname: point a record at the load balancer,
      # issue a certificate for it, add an HTTPS listener, and set this to
      # https-only with domain_name set to that hostname. Worth doing in
      # production, not worth inventing a domain for in dev.
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]

      origin_keepalive_timeout = 5

      # The service answers 202 without waiting for the render, so this is the
      # time to accept a job and not the time to do it.
      origin_read_timeout = 30
    }
  }

  default_cache_behavior {
    target_origin_id       = "publisher-alb"
    viewer_protocol_policy = "https-only"

    # POST only exists in CloudFront's widest method set. The load balancer's
    # default action refuses every path except the two the service serves, so
    # the width here is not a hole.
    allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods  = ["GET", "HEAD"]
    compress        = false

    # Managed-CachingDisabled. A cached 202 would be a publish that never
    # happened, and a cached job record would be a status that never changes.
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

    # Managed-AllViewerExceptHostHeader. The signature header has to reach the
    # origin or every job is refused, and the Host header must not, because the
    # load balancer routes on path and a forwarded viewer Host is noise.
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # The distribution's own *.cloudfront.net certificate. No alias, so no ACM
  # certificate and no DNS record, which is what lets this exist identically in
  # dev, staging and production. minimum_protocol_version is deliberately not
  # set: CloudFront rejects it alongside the default certificate.
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# ---------------------------------------------------------------------------
# The cluster, the task and the service
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "publisher" {
  name              = "/aws/ecs/${local.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

resource "aws_ecs_cluster" "publisher" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = var.tags
}

# The execution role pulls the image and writes the log stream. It is NOT the
# task role: it holds no permission on the site bucket, the tables, the secret
# or the distribution, and it is the identity ECS itself uses rather than the
# one the code runs as.
data "aws_iam_policy_document" "execution_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  description        = "Pulls the publish pipeline image and writes its log stream. Holds nothing the application uses."
  assume_role_policy = data.aws_iam_policy_document.execution_assume_role.json
  tags               = var.tags
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid       = "PullTheImage"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid       = "PullThisRepositoryOnly"
    effect    = "Allow"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = [aws_ecr_repository.publisher.arn]
  }

  statement {
    sid       = "OwnLogGroupOnly"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.publisher.arn}:*"]
  }

  # No KMS statement, and its absence is deliberate rather than an omission.
  # The log group is encrypted with the environment key, but CloudWatch Logs
  # encrypts server side through its own service principal, which the key policy
  # in modules/secrets grants, so the principal WRITING the logs needs nothing.
  # The eight Lambda logging policies in modules/compute are the same shape for
  # the same reason. The image repository is AES256, so there is nothing else
  # here to decrypt.
}

resource "aws_iam_role_policy" "execution" {
  name   = "execution"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

resource "aws_ecs_task_definition" "publisher" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn

  # The renderer's own role, unchanged from the one the compute module built
  # for it. See task_role_arn in variables.tf.
  task_role_arn = var.task_role_arn

  runtime_platform {
    operating_system_family = "LINUX"

    # X86_64 and not ARM64, and it is a deliberate 20 percent more expensive.
    # The image is built and proved on an x86 machine here; an arm64 image
    # would have to be cross built under emulation, including sharp's native
    # binary, and would ship to production having never been run. Switching is
    # one line and one rebuild on a machine that can run it.
    cpu_architecture = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "publisher"
      image     = local.has_image ? var.image_uri : "${aws_ecr_repository.publisher.repository_url}:no-image-has-been-pushed"
      essential = true

      portMappings = [{
        containerPort = local.container_port
        protocol      = "tcp"
      }]

      environment = [
        for key in sort(keys(local.environment)) : {
          name  = key
          value = local.environment[key]
        }
      ]

      # Read only root filesystem is deliberately FALSE and it is the one place
      # this task definition is more permissive than the default advice. The
      # render writes .next, out, public/media and the content snapshot under
      # /srv/build/web. A writable filesystem is not an oversight here, it is
      # the requirement that ruled out the shape the renderer was originally
      # written for.
      readonlyRootFilesystem = false
      user                   = "node"

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.publisher.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "publisher"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${local.container_port}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])

  # 20 GiB is the Fargate default and it is enough: the image unpacks to under
  # 2 GiB and the render's working set is the .next directory, tens of
  # megabytes. Stated rather than left implicit because the writable filesystem
  # is the requirement this host exists to satisfy.
  ephemeral_storage {
    size_in_gib = 21
  }

  tags = var.tags
}

resource "aws_ecs_service" "publisher" {
  name            = local.name
  cluster         = aws_ecs_cluster.publisher.id
  task_definition = aws_ecs_task_definition.publisher.arn
  desired_count   = local.desired_count
  launch_type     = "FARGATE"

  # NEVER TWO TASKS, INCLUDING FOR THE FEW MINUTES OF A DEPLOYMENT. Two
  # publishers interleave their reads and writes of the published manifest and
  # the next diff is then wrong. Maximum percent 100 with minimum healthy zero
  # means the old task is stopped before the new one starts, which costs a
  # short window where a publish would be refused by the load balancer and
  # reported to the editor as a failure. That is the correct trade: a refused
  # publish is visible and retryable, a corrupted manifest is neither.
  deployment_maximum_percent         = 100
  deployment_minimum_healthy_percent = 0

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = [aws_subnet.public[0].id]
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }

  # Attached even at zero tasks. Adding or removing a load balancer on a running
  # ECS service is the kind of change that gets applied on the day the image
  # first lands, which is the worst day for it, so the shape of the service does
  # not depend on desired_count. An empty target group is simply a target group
  # with nothing in it.
  load_balancer {
    target_group_arn = aws_lb_target_group.publisher.arn
    container_name   = "publisher"
    container_port   = local.container_port
  }

  # A task that has just started has to install nothing and render nothing, so
  # this is generous. It exists because the first task after a fresh image push
  # also pulls roughly a gigabyte.
  health_check_grace_period_seconds = 180

  wait_for_steady_state = false

  # The LISTENER RULE, not just the listener. ECS refuses to register a service
  # against a target group that no load balancer references, and the default
  # action on this listener is a fixed 404: it is the forwarding rule that
  # associates the target group with the load balancer.
  depends_on = [aws_lb_listener_rule.publisher]

  tags = var.tags
}
