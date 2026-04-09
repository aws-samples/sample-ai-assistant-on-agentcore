terraform {
  required_version = ">= 0.13.1"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.26.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 2.0"
    }
    # opensearch = {
    #   source  = "opensearch-project/opensearch"
    #   version = ">= 2.0.0"
    # }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      env    = var.env
      repo   = "sparky"
      region = "us-east-1"
    }
  }
}

# terraform {
#   backend "s3" {}
# }


