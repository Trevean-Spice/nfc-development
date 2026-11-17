# Deploy items: kept in Trevean's private location

The files that used to sit in this folder live in **Trevean's private location**, not in this public repository, with the same folder layout (`build/infrastructure/deploy-items/...`).

They are the one-shot deployment records for Trevean's AWS estate: one numbered approval per file (`00-terraform-prerequisites.md` to `06-blend-vercel.md`), the IAM policy documents in `iam/`, the helper runners in `scripts/` (including `zone-check.mjs`, the Route 53 zone checker that generated `envs/dev/zone-copy.auto.tfvars`), and their offline tests in `test/`. Every one of them names real account ids and resource ids, which is why they are not public. All of them have already been run.

What that means here:

- Nothing in the public tree imports or runs them. CI does not run their tests.
- References to `deploy-items/...` in `envs/dev/variables.tf` and `envs/dev/zone-copy.auto.tfvars.example` point at the private copy.
- To work on them, copy the private folder back to this path. `.gitignore` keeps everything here except this README out of commits, so the real values cannot be committed by accident.
