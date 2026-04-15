locals {
  prefix        = "sparky"
  building_path = "./build/"
  aws_region    = var.region
  environment   = var.env
  allowed_origins = [
    "http://localhost:3000",
    "https://${aws_amplify_branch.develop.branch_name}.${aws_amplify_app.sparky.default_domain}",
    "http://localhost:5173"
  ]

  # Content-based image tags — change automatically when source files change,
  # forcing AgentCore runtimes to pull the updated container image.
  sparky_image_tag = substr(sha256(join("", [
    filemd5("${path.module}/../backend/sparky/Dockerfile"),
    filemd5("${path.module}/../backend/sparky/requirements.txt"),
    sha256(join("", [for f in fileset("${path.module}/../backend/sparky", "**") :
    filesha256("${path.module}/../backend/sparky/${f}")]))
  ])), 0, 12)

  core_services_image_tag = substr(sha256(join("", [
    filemd5("${path.module}/../backend/core_services/Dockerfile"),
    filemd5("${path.module}/../backend/core_services/requirements.txt"),
    sha256(join("", [for f in fileset("${path.module}/../backend/core_services", "**/*.py") :
    filesha256("${path.module}/../backend/core_services/${f}")]))
  ])), 0, 12)
}
