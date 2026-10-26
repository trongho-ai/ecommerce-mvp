-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Role" (
    "roleid" SERIAL NOT NULL,
    "rolename" VARCHAR(50) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("roleid")
);

-- CreateTable
CREATE TABLE "MemberShip" (
    "mid" SERIAL NOT NULL,
    "mname" VARCHAR(50) NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MemberShip_pkey" PRIMARY KEY ("mid")
);

-- CreateTable
CREATE TABLE "User" (
    "uid" SERIAL NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "fullname" VARCHAR(100) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "roleid" INTEGER NOT NULL,
    "mid" INTEGER NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("uid")
);

-- CreateTable
CREATE TABLE "Product" (
    "pid" SERIAL NOT NULL,
    "pname" VARCHAR(100) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("pid")
);

-- CreateTable
CREATE TABLE "Order" (
    "oid" SERIAL NOT NULL,
    "uid" INTEGER NOT NULL,
    "createat" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("oid")
);

-- CreateTable
CREATE TABLE "OrderDetail" (
    "oid" INTEGER NOT NULL,
    "pid" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "OrderDetail_pkey" PRIMARY KEY ("oid","pid")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "shipid" SERIAL NOT NULL,
    "oid" INTEGER NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("shipid")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_rolename_key" ON "Role"("rolename");

-- CreateIndex
CREATE UNIQUE INDEX "MemberShip_mname_key" ON "MemberShip"("mname");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_roleid_idx" ON "User"("roleid");

-- CreateIndex
CREATE INDEX "User_mid_idx" ON "User"("mid");

-- CreateIndex
CREATE INDEX "Order_uid_createat_idx" ON "Order"("uid", "createat");

-- CreateIndex
CREATE INDEX "OrderDetail_pid_idx" ON "OrderDetail"("pid");

-- CreateIndex
CREATE INDEX "Shipment_oid_idx" ON "Shipment"("oid");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleid_fkey" FOREIGN KEY ("roleid") REFERENCES "Role"("roleid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_mid_fkey" FOREIGN KEY ("mid") REFERENCES "MemberShip"("mid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_uid_fkey" FOREIGN KEY ("uid") REFERENCES "User"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDetail" ADD CONSTRAINT "OrderDetail_oid_fkey" FOREIGN KEY ("oid") REFERENCES "Order"("oid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDetail" ADD CONSTRAINT "OrderDetail_pid_fkey" FOREIGN KEY ("pid") REFERENCES "Product"("pid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_oid_fkey" FOREIGN KEY ("oid") REFERENCES "Order"("oid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business invariants also enforced when SQL bypasses the API.
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_nonnegative" CHECK ("price" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "OrderDetail" ADD CONSTRAINT "OrderDetail_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "OrderDetail" ADD CONSTRAINT "OrderDetail_unit_price_nonnegative" CHECK ("unit_price" >= 0);
ALTER TABLE "MemberShip" ADD CONSTRAINT "MemberShip_score_nonnegative" CHECK ("score" >= 0);
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_status_allowed" CHECK ("status" IN ('PENDING', 'SHIPPED', 'DELIVERED'));
