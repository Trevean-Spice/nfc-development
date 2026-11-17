terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

# us-east-1 for everything, and for two reasons rather than habit.
#
# The ACM certificate CloudFront reads must be in us-east-1: a certificate in
# any other region cannot be attached and the flip cannot proceed.
#
# CloudFront publishes its metrics to us-east-1 only, so a CloudFront alarm
# created anywhere else watches a metric that never arrives and sits in
# INSUFFICIENT_DATA forever, which looks exactly like health.
#
# There is no latency argument either way: the customer is served by the edge,
# not by the region, and nothing on the tap path touches a regional service.
#
# Placeholders: <TREVEAN_DEV_ACCOUNT_ID>, <TREVEAN_MANAGEMENT_ACCOUNT_ID>,
# <TREVEAN_ORG_ID> and the <TREVEAN_..._ROOT_EMAIL> values stand in for
# Trevean's real identifiers. The real values are in Trevean's private
# record, not in this public repository.
#
# THE ACCOUNT GUARD.
#
# Staging is meant to run in an account we control, and the credentials most
# likely to be exported in the shell on this project are Trevean's, currently
# <TREVEAN_DEV_ACCOUNT_ID>. envs/prod/variables.tf describes the guard as preventing "a
# staging apply landing in Trevean's" account; until this line existed that
# half of the sentence was not true of this configuration.
#
# Corrected Thursday 27 August 2026. This note previously named <TREVEAN_DEV_ACCOUNT_ID> as
# Trevean's Organization management account. It is not. It is
# Trevean-NFC-Development, the development account, and it is the correct
# target for envs/dev. The management account is <TREVEAN_MANAGEMENT_ACCOUNT_ID>, Trevean Spice.
# Neither of them is staging's account, so the guard here is unchanged in
# effect: staging lands in a Serene Labs account or it does not land.
#
# expected_account_id has no default, so an unset value is a hard error rather
# than a silently disabled guard. See variables.tf.

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.expected_account_id]

  default_tags {
    tags = {
      Project     = "trevean-spice-nfc"
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}

provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = [var.expected_account_id]

  default_tags {
    tags = {
      Project     = "trevean-spice-nfc"
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}
