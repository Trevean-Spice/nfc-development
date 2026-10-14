# Partial backend configuration. See BOOTSTRAP.md.
#
#   terraform init -backend-config=backend.hcl

terraform {
  backend "s3" {}
}
