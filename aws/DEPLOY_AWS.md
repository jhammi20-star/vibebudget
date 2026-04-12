# AWS Deployment

This app is prepared for a small-production AWS deployment with:

- Docker container on Amazon ECS
- one ECS service/task for the app
- Amazon EFS mounted at `/app/data` for persistent SQLite app data and SQLite-backed session data
- Application Load Balancer with HTTPS via AWS Certificate Manager
- secrets stored outside the image in AWS Secrets Manager or SSM Parameter Store

## Recommended architecture

Use ECS Fargate for the app, EFS for persistence, and an ALB for TLS termination.

Why this shape:

- the app already uses SQLite, so EFS gives it persistent shared storage
- the container stays stateless except for mounted data
- HTTPS, private networking, and managed certificates are straightforward

## Security checklist

- Put the ECS tasks in private subnets.
- Put the ALB in public subnets.
- Terminate HTTPS on the ALB with an ACM certificate.
- Redirect HTTP to HTTPS at the ALB.
- Store `SESSION_SECRET` in Secrets Manager or Parameter Store.
- Restrict the ECS security group so only the ALB can reach port `3000`.
- Restrict EFS access points/security groups to the ECS task only.
- Keep one running task unless you migrate away from SQLite.

## Required environment variables

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT=3000`
- `DATA_DIR=/app/data`
- `SESSION_SECRET=<long-random-secret>`

## Container build

```bash
docker build -t vibe-budget:latest .
```

## Deployment notes

1. Create an ECR repository and push the image.
2. Create an EFS filesystem and access point for `/app/data`.
3. Create an ECS task definition mounting the EFS access point to `/app/data`.
4. Create an ECS service in private subnets.
5. Place an ALB in front of the service.
6. Attach an ACM certificate to the HTTPS listener.
7. Inject `SESSION_SECRET` from Secrets Manager or Parameter Store.

## Important limitation

This is secure for a small household deployment, but it is still a single-writer SQLite app.
For multi-instance scaling, failover, or heavier production use, the next step is migrating to RDS PostgreSQL and a network session store.
