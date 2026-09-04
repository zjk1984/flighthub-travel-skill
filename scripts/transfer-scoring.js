/**
 * Transfer dimension scoring: penalties stack separately from base 100.
 *
 * - Direct: 100
 * - 1 transfer: -25 → base 75
 * - ≥2 transfers: -50 → base 50
 * - Cross-day: -25 (independent)
 * - Custom self-transfer: -25 (independent)
 */
const TRANSFER_SCORE_MAX = 100;
const PENALTY_ONE_TRANSFER = 25;
const PENALTY_MULTI_TRANSFER = 50;
const PENALTY_CROSS_DAY = 25;
const PENALTY_CUSTOM_TRANSFER = 25;

function dayOf(dt) {
  return dt ? dt.slice(0, 10) : "";
}

function isCrossDayOverall(f) {
  return dayOf(f.depDateTime) !== dayOf(f.arrDateTime);
}

function isCrossDaySegment(f) {
  const segs = f.segments || [];
  for (let i = 0; i < segs.length - 1; i++) {
    if (dayOf(segs[i].arrDateTime) !== dayOf(segs[i + 1].depDateTime)) return true;
  }
  return false;
}

/** API 联程看整体或航段跨日；自定义中转仅看整体到达是否跨日。 */
function isCrossDayForPenalty(f) {
  if (f.customTransfer) return isCrossDayOverall(f);
  return isCrossDayOverall(f) || isCrossDaySegment(f);
}

function transferCountPenalty(transfers) {
  const n = transfers ?? 0;
  if (n >= 2) return PENALTY_MULTI_TRANSFER;
  if (n === 1) return PENALTY_ONE_TRANSFER;
  return 0;
}

function transferScoreBreakdown(f) {
  const countPenalty = transferCountPenalty(f.transfers);
  const crossDayPenalty = isCrossDayForPenalty(f) ? PENALTY_CROSS_DAY : 0;
  const customPenalty = f.customTransfer ? PENALTY_CUSTOM_TRANSFER : 0;
  const basePts = TRANSFER_SCORE_MAX - countPenalty;
  const transferPts = Math.max(
    0,
    TRANSFER_SCORE_MAX - countPenalty - crossDayPenalty - customPenalty
  );
  return {
    transferPts,
    basePts,
    transferBasePts: basePts,
    transferCountPenalty: countPenalty,
    crossDayPenalty,
    customPenalty,
  };
}

function transferPoints(count, f) {
  return transferScoreBreakdown({ ...f, transfers: count }).transferPts;
}

function renderTransferScoringGuideRows(transferWeightPct) {
  return `| 转机 | ${transferWeightPct}% | 满分 100；**转机 1 次 -25**（基础 75）；**≥2 次 -50**（基础 50）；**跨日 -25**、**自定义中转 -25** 与次数扣分**分开叠加** |`;
}

function appendTransferDeductionItems(f, items) {
  if (f.transferCountPenalty > 0) {
    if ((f.transfers ?? 0) >= 2) {
      items.push(`转机 ≥2 次 -${f.transferCountPenalty} → 基础 ${f.transferBasePts}`);
    } else {
      items.push(`转机 1 次 -${f.transferCountPenalty} → 基础 ${f.transferBasePts}`);
    }
  } else if (f.customPenalty > 0 || f.crossDayPenalty > 0) {
    items.push(`直达 → 基础 ${f.transferBasePts}`);
  } else if ((f.transfers ?? 0) >= 2) {
    items.push(`转机 ≥2 次 -${f.transferCountPenalty || PENALTY_MULTI_TRANSFER} → 基础 ${f.transferPts}`);
  } else if ((f.transfers ?? 0) > 0) {
    items.push(`转机 1 次 -${f.transferCountPenalty || PENALTY_ONE_TRANSFER} → 基础 ${f.transferPts}`);
  } else {
    items.push(`转机分 ${f.transferPts}：直达（满分 100）`);
    return;
  }

  let running = f.transferBasePts;
  if (f.crossDayPenalty > 0) {
    running -= f.crossDayPenalty;
    items.push(`跨日 -${f.crossDayPenalty} → 转机分 ${running}`);
  }
  if (f.customPenalty > 0) {
    running -= f.customPenalty;
    items.push(`自定义中转 -${f.customPenalty} → 转机分 ${running}`);
  }
  if (f.crossDayPenalty > 0 || f.customPenalty > 0 || f.transferCountPenalty > 0) {
    items.push(`转机分合计 ${f.transferPts}`);
  }
}

module.exports = {
  TRANSFER_SCORE_MAX,
  PENALTY_ONE_TRANSFER,
  PENALTY_MULTI_TRANSFER,
  PENALTY_CROSS_DAY,
  PENALTY_CUSTOM_TRANSFER,
  dayOf,
  isCrossDayOverall,
  isCrossDaySegment,
  isCrossDayForPenalty,
  transferCountPenalty,
  transferScoreBreakdown,
  transferPoints,
  renderTransferScoringGuideRows,
  appendTransferDeductionItems,
};
