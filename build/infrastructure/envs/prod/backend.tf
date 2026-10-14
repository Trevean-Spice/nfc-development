# Partial backend configuration.
#
#   terraform init -backend-config=backend.hcl
#
# PRODUCTION STATE LIVES IN TREVEAN'S ACCOUNT, not ours. That is not a
# preference. The deliverables are work for hire and the IP clause gives
# Trevean the right to engage any third party to modify them, which is
# meaningless if the file describing what is currently deployed sits in a
# contractor's bucket. See BOOTSTRAP.md, section on production state.

terraform {
  backend "s3" {}
}
