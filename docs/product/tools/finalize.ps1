# Opens each generated Word file in Microsoft Word, fills the table of contents, saves it,
# and exports a PDF copy (docs/product/word/pdf). Requires Word on Windows.
# Each file runs in its own background job with a timeout: hidden Word can block on COM calls when driven
# directly from some hosts, and Document.Fields.Update() hangs on these files (page fields update on render anyway).
param([string]$Filter = '*.docx', [switch]$NoPdf, [int]$TimeoutSec = 240)
$ErrorActionPreference = 'Stop'
$word = (Resolve-Path (Join-Path $PSScriptRoot '..\word')).Path
$pdfDir = Join-Path $word 'pdf'
if (-not $NoPdf) { New-Item -ItemType Directory -Force $pdfDir | Out-Null }
$failed = 0
foreach ($f in Get-ChildItem $word -Filter $Filter) {
  $pdf = if ($NoPdf) { '' } else { Join-Path $pdfDir ($f.BaseName + '.pdf') }
  $job = Start-Job -ArgumentList $f.FullName, $pdf -ScriptBlock {
    param($path, $pdf)
    $app = New-Object -ComObject Word.Application
    $app.Visible = $false
    $app.DisplayAlerts = 0
    try {
      $doc = $app.Documents.Open($path, $false, $false, $false)
      foreach ($toc in $doc.TablesOfContents) { $toc.Update() }
      $pages = $doc.ComputeStatistics(2)
      $doc.Save()
      if ($pdf) { $doc.ExportAsFixedFormat($pdf, 17) }
      $doc.Close($false)
      $pages
    } finally { $app.Quit() }
  }
  if (Wait-Job $job -Timeout $TimeoutSec) {
    $pages = Receive-Job $job
    "{0}: {1} pages" -f $f.Name, $pages
  } else {
    "{0}: TIMEOUT" -f $f.Name
    $failed++
    Stop-Job $job
    Get-CimInstance Win32_Process -Filter "Name='WINWORD.EXE'" | Where-Object { $_.CommandLine -like '*/Automation*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  }
  Remove-Job $job -Force
}
if ($failed) { exit 1 }
