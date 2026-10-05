# Minimal VPC for an EKS lab.
#
#   public subnets : worker nodes and load balancers. Route to the internet gateway.
#   data subnets   : RDS. NO route to the internet at all (only the implicit local route).
#
# There is deliberately no NAT gateway: it costs about $33/month even when idle.
# Nodes get public IPs instead and are protected by security groups (no inbound from the
# internet). In a real company you would use private subnets plus NAT or VPC endpoints.

data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  cluster_tag = var.cluster_name == null ? {} : {
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true # needed by EKS and RDS endpoints

  tags = { Name = var.name }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = var.name }
}

# ---- public subnets: /22 each (1019 usable IPs), because every pod takes an IP from here ----
resource "aws_subnet" "public" {
  count = var.az_count

  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.cidr, 6, count.index) # 10.20.0.0/22, 10.20.4.0/22
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true # nodes need a public IP to reach ECR and the EKS API without NAT

  tags = merge(local.cluster_tag, {
    Name                     = "${var.name}-public-${local.azs[count.index]}"
    Tier                     = "public"
    "kubernetes.io/role/elb" = "1" # internet-facing load balancers are placed here
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name}-public" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count = var.az_count

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ---- data subnets: isolated, for the database ----
resource "aws_subnet" "data" {
  count = var.az_count

  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.cidr, 8, 100 + count.index) # 10.20.100.0/24, 10.20.101.0/24
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${var.name}-data-${local.azs[count.index]}"
    Tier = "data"
  }
}

# a route table with no routes of its own: traffic can only stay inside the VPC
resource "aws_route_table" "data" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name}-data" }
}

resource "aws_route_table_association" "data" {
  count = var.az_count

  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data.id
}
