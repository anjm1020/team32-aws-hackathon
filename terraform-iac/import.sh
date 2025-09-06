#!/bin/bash

# Import existing AWS resources into Terraform state
echo "Importing existing AWS resources..."

# Import Security Group
terraform import aws_security_group.launch_wizard_2 sg-06bed288d89660a14

# Import Elastic IP
terraform import aws_eip.amazonq_server_eip eipalloc-0ad2b61d023134433

# Import EC2 Instance
terraform import aws_instance.amazonq_server i-02e5fe67ced59b54b

# Import EIP Association
terraform import aws_eip_association.amazonq_server_eip_assoc eipassoc-01cfb049a139b0270

echo "Import completed. Run 'terraform plan' to verify the configuration matches your existing resources."
