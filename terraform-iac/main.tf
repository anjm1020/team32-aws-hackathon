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
resource "aws_security_group" "launch_wizard_2" {
  name        = "launch-wizard-2"
  description = "launch-wizard-2 created 2025-09-05T02:22:52.344Z"
  vpc_id      = "vpc-0d577dec2234b7bab"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 5000
    to_port     = 5000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "application port"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "launch-wizard-2"
  }
}

# Elastic IP
resource "aws_eip" "amazonq_server_eip" {
  domain = "vpc"
  
  tags = {
    Name = "amazonQ-server-eip"
  }
}

# Data source to get latest Amazon Linux 2023 AMI
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]
  
  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
  
  filter {
    name   = "state"
    values = ["available"]
  }
}

# EC2 Instance
resource "aws_instance" "amazonq_server" {
  ami                     = data.aws_ami.amazon_linux.id
  instance_type          = "t2.2xlarge"
  key_name               = "hackaton"
  subnet_id              = "subnet-01cafce860c473f42"
  vpc_security_group_ids = [aws_security_group.launch_wizard_2.id]
  availability_zone      = "us-east-1c"
  
  iam_instance_profile = "amazonQ-mcp-adminfullaccess"
  
  user_data = base64encode(<<-EOF
    #!/bin/bash
    yum update -y
    yum install -y git
    cd /home/ec2-user
    git clone ${var.repository_url}
    chown -R ec2-user:ec2-user /home/ec2-user/${var.repository_name}
  EOF
  )
  
  root_block_device {
    volume_type           = "gp3"
    volume_size           = 32
    iops                  = 3000
    throughput            = 125
    delete_on_termination = true
    encrypted             = false
  }

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
    http_put_response_hop_limit = 2
  }

  tags = {
    Name = "amazonQ-server"
  }
}

# EIP Association
resource "aws_eip_association" "amazonq_server_eip_assoc" {
  instance_id   = aws_instance.amazonq_server.id
  allocation_id = aws_eip.amazonq_server_eip.id
}
