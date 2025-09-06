output "instance_id" {
  description = "ID of the EC2 instance"
  value       = aws_instance.amazonq_server.id
}

output "instance_public_ip" {
  description = "Public IP address of the EC2 instance"
  value       = aws_eip.amazonq_server_eip.public_ip
}

output "instance_private_ip" {
  description = "Private IP address of the EC2 instance"
  value       = aws_instance.amazonq_server.private_ip
}

output "security_group_id" {
  description = "ID of the security group"
  value       = aws_security_group.launch_wizard_2.id
}

output "eip_allocation_id" {
  description = "Allocation ID of the Elastic IP"
  value       = aws_eip.amazonq_server_eip.id
}

output "repository_url" {
  description = "Repository URL that was cloned"
  value       = var.repository_url
}

output "ami_id" {
  description = "AMI ID used for the instance"
  value       = data.aws_ami.amazon_linux.id
}
