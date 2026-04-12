
#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-vibe-budget}"
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-vibe-budget-prod}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"

echo "Deploying stack ${STACK_NAME} in ${AWS_REGION}..."
aws cloudformation deploy \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file aws/ecs-stack.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    AppName="${APP_NAME}" \
    ContainerImage="public.ecr.aws/docker/library/nginx:stable"

REPOSITORY_URI="$(aws cloudformation describe-stacks \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue" \
  --output text)"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

echo "Building Docker image..."
docker build --platform linux/arm64 -t "${APP_NAME}:${IMAGE_TAG}" .
docker tag "${APP_NAME}:${IMAGE_TAG}" "${REPOSITORY_URI}:${IMAGE_TAG}"

echo "Logging into ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "Pushing image ${REPOSITORY_URI}:${IMAGE_TAG}..."
docker push "${REPOSITORY_URI}:${IMAGE_TAG}"

echo "Updating stack to use application image..."
aws cloudformation deploy \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file aws/ecs-stack.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    AppName="${APP_NAME}" \
    ContainerImage="${REPOSITORY_URI}:${IMAGE_TAG}"

APP_URL="$(aws cloudformation describe-stacks \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='AppUrl'].OutputValue" \
  --output text)"

echo "Deployment complete: ${APP_URL}"
