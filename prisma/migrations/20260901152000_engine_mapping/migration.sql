CREATE TABLE "EngineMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "mapping" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EngineMapping_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EngineMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EngineMapping_organizationId_fingerprint_key" ON "EngineMapping"("organizationId", "fingerprint");
