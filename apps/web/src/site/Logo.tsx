/* eslint-disable @next/next/no-img-element */
/**
 * Hydris AI logo (brand book: mark = "H" with negative-space water droplet; wordmark in
 * Unison Pro). `tone` follows the background: white on Hydris blue / dark, blue or
 * black on light surfaces. The mark keeps its clear space via the gap.
 */
export function Logo({ compact = false, tone = 'white', product = true, size = 30 }: { compact?: boolean; tone?: 'white' | 'blue' | 'black'; product?: boolean; size?: number }) {
  const color = tone === 'white' ? '#ffffff' : tone === 'blue' ? '#1746E4' : '#081116';
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap" style={{ color }}>
      <img src={`/brand/mark-${tone}.png`} alt={compact ? 'Hydris AI' : ''} width={size} height={size} style={{ width: size, height: size, objectFit: 'contain' }} />
      {!compact && (
        <span className="inline-flex items-baseline gap-2">
          <Wordmark height={Math.round(size * 0.42)} />
          {product && <span className="text-[13px] font-medium tracking-[0.02em] opacity-90">Field Glasses</span>}
        </span>
      )}
    </span>
  );
}

/** Vector wordmark "HYDRIS AI" extracted from the brand book (inherits currentColor). */
export function Wordmark({ height = 14 }: { height?: number }) {
  return (
    <svg role="img" aria-label="Hydris AI" height={height} viewBox="1143.4 788.8 558.6 55.3" fill="currentColor" style={{ width: 'auto', display: 'block' }}>
      <path fillRule="evenodd" d="M1201.61 790.19L1217.59 790.19L1217.59 842.69L1201.61 842.69L1201.61 822.29L1163.96 822.29L1163.96 842.69L1147.91 842.69L1147.91 790.19L1163.96 790.19L1163.96 810.59L1201.61 810.59L1201.61 790.19M1298.42 790.19L1268.05 822.29L1268.05 842.69L1252.07 842.69L1252.07 822.36L1221.62 790.19L1240.45 790.19L1260.02 810.89L1279.60 790.19L1298.42 790.19M1338.98 842.61L1302.45 842.69L1302.45 790.19L1338.98 790.19C1373.93 790.19 1375.35 791.61 1375.35 816.44C1375.35 841.26 1374.00 842.61 1338.98 842.61M1318.50 829.56L1338.98 829.56C1359.30 829.56 1359.30 829.56 1359.30 816.51C1359.30 803.31 1359.30 803.31 1338.90 803.31L1318.50 803.31L1318.50 829.56M1454.34 810.14C1454.34 817.94 1452.46 820.56 1448.11 822.66C1452.46 824.91 1454.34 825.89 1454.34 838.34L1454.34 842.69L1438.44 842.69L1438.44 838.34C1438.44 832.19 1438.36 830.16 1431.39 830.16L1399.44 830.16L1399.44 842.69L1383.39 842.69L1383.39 790.19L1431.39 790.19C1451.94 790.19 1454.34 791.99 1454.34 810.14M1431.39 817.04C1438.51 817.04 1438.36 814.64 1438.36 810.14C1438.36 805.71 1438.36 803.31 1431.39 803.31M1399.44 803.31H1431.39V817.04H1399.44ZM1462.63 790.19L1478.68 790.19L1478.68 842.69L1462.63 842.69L1462.63 790.19M1522.48 810.59C1552.56 810.59 1558.78 810.59 1558.78 826.64C1558.78 842.69 1552.18 844.11 1522.48 844.11C1492.78 844.11 1486.26 842.76 1486.26 826.41L1502.38 826.41C1502.98 831.14 1505.08 830.99 1522.48 830.99C1539.96 830.99 1542.66 830.99 1542.66 826.64C1542.66 822.29 1540.11 822.29 1522.48 822.29C1492.78 822.29 1486.93 822.29 1486.93 806.24C1486.93 790.19 1493.38 788.76 1522.56 788.76C1551.66 788.76 1558.03 790.49 1558.03 806.46L1541.98 806.46C1541.61 801.89 1540.03 801.89 1522.48 801.89C1504.93 801.89 1502.98 801.89 1502.98 806.24C1502.98 810.59 1505.08 810.59 1522.48 810.59M1663.50 842.69L1658.78 834.06L1623.83 834.06L1619.10 842.69L1601.18 842.69L1629.68 790.19L1652.93 790.19L1681.43 842.69L1663.50 842.69M1630.13 822.36L1652.48 822.36L1641.30 801.81L1630.13 822.36M1685.95 790.19L1702.00 790.19L1702.00 842.69L1685.95 842.69L1685.95 790.19" />
    </svg>
  );
}
