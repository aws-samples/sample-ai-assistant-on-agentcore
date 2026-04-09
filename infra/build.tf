resource "null_resource" "build" {
  triggers = {
    always_run = "${timestamp()}" # This ensures it runs on every apply
  }

  provisioner "local-exec" {
    command     = "bash ${path.module}/build.sh"
    working_dir = path.module # Ensures script runs from the infrastructure directory
  }
}