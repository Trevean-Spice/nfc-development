#!/usr/bin/env bash
#
# Build the publish pipeline image and push it to the repository the Terraform
# created.
#
#   ./scripts/push-image.sh <aws-account-id> <region> <repository-name> [tag]
#
# Get the repository name from the environment you are deploying into:
#
#   cd build/infrastructure/envs/dev
#   terraform output publisher
#
# The tag defaults to the short git commit, which is the only tag that answers
# "what is running" without anybody having to remember. The repository is
# created with IMMUTABLE tags, so pushing the same tag twice fails rather than
# silently changing what a running task would restart into.
#
# WHAT THIS DOES NOT DO: it does not update the service. Terraform owns the
# task definition, so the last step is setting publisher_image_uri in the
# environment's tfvars to the URI this script prints and running an apply. That
# is the same split every Lambda in this project already has, in the other
# direction: there, Terraform owns identity and the pipeline owns code, and
# every function carries ignore_changes on its package. Here the image URI is
# small enough to be configuration, and having it in the task definition means
# the plan says which image is about to run.
#
# NOTHING IN THIS SCRIPT REACHES AWS EXCEPT THE LOGIN AND THE PUSH. It can be
# read in a minute and there is no hidden state.

set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <aws-account-id> <region> <repository-name> [tag]" >&2
  exit 2
fi

ACCOUNT="$1"
REGION="$2"
REPOSITORY="$3"
TAG="${4:-$(git rev-parse --short HEAD)}"

HERE="$(cd "$(dirname "$0")/.." && pwd)"
CONTEXT="$(cd "${HERE}/.." && pwd)"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
URI="${REGISTRY}/${REPOSITORY}:${TAG}"

echo "context     ${CONTEXT}"
echo "dockerfile  ${HERE}/Dockerfile"
echo "image       ${URI}"
echo

# linux/amd64 explicitly, and it matches runtime_platform in the Terraform.
# An image built on an Apple Silicon laptop defaults to arm64 and would be
# pulled by a task definition that asked for X86_64, which fails at task start
# with an exec format error and not at push time.
docker build \
  --platform linux/amd64 \
  -f "${HERE}/Dockerfile" \
  -t "${URI}" \
  "${CONTEXT}"

aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"

docker push "${URI}"

DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "${URI}" 2>/dev/null || true)"

echo
echo "pushed  ${URI}"
if [ -n "${DIGEST}" ]; then
  echo "digest  ${DIGEST}"
  echo
  echo "In production pin the digest rather than the tag:"
  echo "  publisher_image_uri = \"${DIGEST}\""
else
  echo
  echo "Set in the environment's terraform.tfvars, then apply:"
  echo "  publisher_image_uri = \"${URI}\""
fi
