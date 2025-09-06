terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# Security Group
resource "aws_security_group" "ec2_sg" {
  name_prefix = "ec2-sg-"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 5000
    to_port     = 5000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# IAM Role
resource "aws_iam_role" "ec2_role" {
  name = "ec2-full-access-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

# IAM Policy Attachment (전체 권한)
resource "aws_iam_role_policy_attachment" "ec2_admin_policy" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# IAM Instance Profile
resource "aws_iam_instance_profile" "ec2_profile" {
  name = "ec2-instance-profile"
  role = aws_iam_role.ec2_role.name
}

# IAM User for EC2
resource "aws_iam_user" "ec2_user" {
  name = "ec2-access-user"
}

# IAM User Policy Attachment
resource "aws_iam_user_policy_attachment" "ec2_user_policy" {
  user       = aws_iam_user.ec2_user.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# Access Key for IAM User
resource "aws_iam_access_key" "ec2_user_key" {
  user = aws_iam_user.ec2_user.name
}

# Key Pair for SSH
resource "aws_key_pair" "ec2_key" {
  key_name   = "ec2-terraform-key"
  public_key = file("~/.ssh/id_rsa.pub")
}

# EC2 Instance
resource "aws_instance" "main" {
  ami                    = "ami-0e393e7cd41d6a11d"
  instance_type          = "t2.xlarge"
  vpc_security_group_ids = [aws_security_group.ec2_sg.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name
  key_name               = aws_key_pair.ec2_key.key_name

  user_data = base64encode(<<-EOF
    #!/bin/bash
    yum update -y
    aws configure set aws_access_key_id ${aws_iam_access_key.ec2_user_key.id}
    aws configure set aws_secret_access_key ${aws_iam_access_key.ec2_user_key.secret}
    aws configure set default.region us-east-1
  EOF
  )

  tags = {
    Name = "terraform-ec2"
  }
}

# Outputs
output "instance_id" {
  value = aws_instance.main.id
}

output "public_ip" {
  value = aws_instance.main.public_ip
}

output "security_group_id" {
  value = aws_security_group.ec2_sg.id
}

output "access_key_id" {
  value = aws_iam_access_key.ec2_user_key.id
}

output "secret_access_key" {
  value     = aws_iam_access_key.ec2_user_key.secret
  sensitive = true
}

output "ssh_connection_url" {
  value = "ssh -i ~/.ssh/id_rsa ec2-user@${aws_instance.main.public_ip}"
}
