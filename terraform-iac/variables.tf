variable "repository_url" {
  description = "Public repository URL to clone"
  type        = string
  default     = "https://github.com/your-username/your-repository.git"
}

variable "repository_name" {
  description = "Repository name (extracted from URL)"
  type        = string
  default     = "your-repository"
}
