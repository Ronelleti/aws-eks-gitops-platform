# Container registries for the app images. GitHub Actions pushes here, EKS pulls from here.
resource "aws_ecr_repository" "app" {
  for_each = toset(var.ecr_repositories)

  name = each.value

  # A tag can never be overwritten: "tasks-api:abc123" always means the same image.
  # CI tags images with the git commit SHA, so every build gets a new tag.
  image_tag_mutability = "IMMUTABLE"

  # basic vulnerability scan of every pushed image (free)
  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# Delete old images automatically so storage never grows
resource "aws_ecr_lifecycle_policy" "app" {
  for_each = aws_ecr_repository.app

  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep only the newest ${var.images_to_keep} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.images_to_keep
      }
      action = { type = "expire" }
    }]
  })
}
