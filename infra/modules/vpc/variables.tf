variable "name" {
  description = "Name prefix for every resource in this VPC"
  type        = string
}

variable "cidr" {
  description = "VPC CIDR block (a /16 is expected)"
  type        = string
  default     = "10.20.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to spread subnets across (EKS needs at least 2)"
  type        = number
  default     = 2
}

variable "cluster_name" {
  description = "EKS cluster name, used to tag subnets so load balancers can find them (null = no tags)"
  type        = string
  default     = null
}
