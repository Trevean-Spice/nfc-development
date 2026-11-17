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

# us-east-1 for the same two reasons as every other environment: ACM
# certificates for CloudFront must live there, and CloudFront publishes its
# metrics there. See envs/staging/providers.tf for the longer note.
#
# Placeholders: <TREVEAN_DEV_ACCOUNT_ID>, <TREVEAN_MANAGEMENT_ACCOUNT_ID>,
# <TREVEAN_ORG_ID> and the <TREVEAN_..._ROOT_EMAIL> values stand in for
# Trevean's real identifiers. The real values are in Trevean's private
# record, not in this public repository.
#
# THE ACCOUNT GUARD IS NOT DECORATION HERE.
#
# CORRECTED THURSDAY 27 AUGUST 2026. This comment previously said that
# <TREVEAN_DEV_ACCOUNT_ID> is Trevean's Organization management account and that an apply
# here would build a dev stack inside it. That was backwards, and it was wrong
# from Monday 24 August to Thursday 27 August 2026.
#
#   <TREVEAN_MANAGEMENT_ACCOUNT_ID>  Trevean Spice, <TREVEAN_MANAGEMENT_ROOT_EMAIL>
#                 the Organization management account, org <TREVEAN_ORG_ID>
#   <TREVEAN_DEV_ACCOUNT_ID>  Trevean-NFC-Development, <TREVEAN_DEV_ROOT_EMAIL>
#                 the development account, and the correct target for THIS
#                 directory
#
# Verified with aws organizations list-accounts and describe-organization. The
# error came from taking the client's description of his estate and assuming
# the credentials in hand matched it. The account was checked for emptiness and
# never for name. An inventory is not an identity check.
#
# The guard is still not decoration. Ambient credentials on this project can
# point at either account, and a dev apply belongs in <TREVEAN_DEV_ACCOUNT_ID> and nowhere
# else. What changed is which id is correct, not whether the guard is needed.
#
# expected_account_id has no default, so an unset value is a hard error rather
# than a silently disabled guard. See variables.tf.

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.expected_account_id]

  default_tags {
    tags = {
      Project     = "trevean-spice-nfc"
      Environment = "dev"
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
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}
