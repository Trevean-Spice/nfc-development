# Partial backend configuration.
#
# The values live in backend.hcl, which is not committed, because they name an
# account and a bucket. Initialise with:
#
#   terraform init -backend-config=backend.hcl
#
# See BOOTSTRAP.md for how the state bucket is created, why it is created
# outside this configuration, and why native S3 locking is used rather than a
# DynamoDB lock table.

terraform {
  backend "s3" {}
}
