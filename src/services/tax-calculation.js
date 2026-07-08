function normalizeTaxCode(value) {
  return String(value || '').trim().toUpperCase();
}

function isPercentageTaxType(taxType = {}) {
  return normalizeTaxCode(taxType.code) === 'PT';
}

function isVatTaxType(taxType = {}) {
  return normalizeTaxCode(taxType.code) === 'VAT';
}

function roundCurrency(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function resolveTaxMode(taxType = {}) {
  if (isPercentageTaxType(taxType)) {
    return 'PT';
  }
  if (isVatTaxType(taxType)) {
    return 'VAT';
  }
  return normalizeTaxCode(taxType.code) || 'NONE';
}

module.exports = {
  isPercentageTaxType,
  isVatTaxType,
  normalizeTaxCode,
  resolveTaxMode,
  roundCurrency,
};
