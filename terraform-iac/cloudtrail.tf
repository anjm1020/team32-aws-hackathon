# Note: The CloudTrail trails shown are organization-level trails managed by AWS Event Engine
# These are typically not managed by individual accounts and should not be imported

# If you need to create your own CloudTrail, uncomment and modify the following:

# resource "aws_s3_bucket" "cloudtrail_bucket" {
#   bucket        = "my-cloudtrail-logs-bucket"
#   force_destroy = true
# }

# resource "aws_s3_bucket_policy" "cloudtrail_bucket_policy" {
#   bucket = aws_s3_bucket.cloudtrail_bucket.id
#   policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Sid    = "AWSCloudTrailAclCheck"
#         Effect = "Allow"
#         Principal = {
#           Service = "cloudtrail.amazonaws.com"
#         }
#         Action   = "s3:GetBucketAcl"
#         Resource = aws_s3_bucket.cloudtrail_bucket.arn
#       },
#       {
#         Sid    = "AWSCloudTrailWrite"
#         Effect = "Allow"
#         Principal = {
#           Service = "cloudtrail.amazonaws.com"
#         }
#         Action   = "s3:PutObject"
#         Resource = "${aws_s3_bucket.cloudtrail_bucket.arn}/*"
#         Condition = {
#           StringEquals = {
#             "s3:x-amz-acl" = "bucket-owner-full-control"
#           }
#         }
#       }
#     ]
#   })
# }

# resource "aws_cloudtrail" "main" {
#   name           = "main-cloudtrail"
#   s3_bucket_name = aws_s3_bucket.cloudtrail_bucket.bucket
#   
#   include_global_service_events = true
#   is_multi_region_trail        = true
#   enable_logging               = true
#   
#   tags = {
#     Name = "main-cloudtrail"
#   }
# }
