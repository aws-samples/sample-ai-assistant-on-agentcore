# System Skills Provisioning
# Syncs system-skills/ directory to S3 /system/ partition and upserts DynamoDB metadata.
# When system-skills/ folder is absent, fileset returns empty — no resources created.

locals {
  system_skills_path = "${path.module}/../system-skills"

  # Exclude hidden files/directories (e.g. .DS_Store) from the fileset
  system_skills_files = toset([
    for f in fileset(local.system_skills_path, "**/*") : f
    if !anytrue([for part in split("/", f) : startswith(part, ".")])
  ])

  # Extract unique top-level directory names (skill names) from the fileset
  system_skill_names = toset(distinct([
    for f in local.system_skills_files : split("/", f)[0]
  ]))

  # Read name and description from SKILL.md frontmatter for each skill
  system_skill_metadata = {
    for dir in local.system_skill_names : dir => {
      name = try(
        trimspace(replace(
          regex("(?m)^name:.+$", file("${local.system_skills_path}/${dir}/SKILL.md")),
          "name:", ""
        )),
        dir
      )
      description = try(
        trimspace(replace(
          regex("(?m)^description:.+$", file("${local.system_skills_path}/${dir}/SKILL.md")),
          "description:", ""
        )),
        ""
      )
    }
  }
}

# Sync system-skills/ directory to S3 /system/ partition
resource "aws_s3_object" "system_skills" {
  for_each = local.system_skills_files

  bucket = aws_s3_bucket.skills_bucket.id
  key    = "system/${each.value}"
  source = "${local.system_skills_path}/${each.value}"
  etag   = filemd5("${local.system_skills_path}/${each.value}")
}

# Upsert DynamoDB metadata records for each system skill
resource "null_resource" "system_skill_metadata" {
  for_each = local.system_skill_names

  triggers = {
    skill_name  = lookup(local.system_skill_metadata[each.value], "name", each.value)
    table_name  = aws_dynamodb_table.skills.name
    description = lookup(local.system_skill_metadata[each.value], "description", "")
  }

  provisioner "local-exec" {
    command = <<-EOT
      aws dynamodb put-item \
        --table-name "${aws_dynamodb_table.skills.name}" \
        --region "${local.aws_region}" \
        --item '{
          "user_id": {"S": "system"},
          "skill_name": {"S": "${lookup(local.system_skill_metadata[each.value], "name", each.value)}"},
          "description": {"S": "${replace(lookup(local.system_skill_metadata[each.value], "description", ""), "'", "'")}"},
          "s3_content_path": {"S": "system/${each.value}/"},
          "created_by": {"S": "system"},
          "visibility": {"S": "public"},
          "created_at": {"S": "${timestamp()}"},
          "updated_at": {"S": "${timestamp()}"}
        }'
    EOT
  }
}
