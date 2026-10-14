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

# PRODUCTION RUNS IN TREVEAN'S AWS ACCOUNT.
#
# The account exists as of 12 August but is a virgin install and unconfigured
# (risk R3). Our offer to configure it is open and unanswered as of today.
#
# There is deliberately NO hardcoded account id, profile or role ARN here.
# Credentials come from the environment, and the account guard below is what
# stops a production apply landing in the wrong account: set
# expected_account_id in terraform.tfvars and Terraform refuses to proceed if
# the caller is anywhere else.
#
# us-east-1, because the ACM certificate CloudFront reads must be there and
# because CloudFront publishes its metrics there.

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = var.expected_account_id == null ? null : [var.expected_account_id]

  default_tags {
    tags = {
      Project     = "trevean-spice-nfc"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = var.expected_account_id == null ? null : [var.expected_account_id]

  default_tags {
    tags = {
      Project     = "trevean-spice-nfc"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}
