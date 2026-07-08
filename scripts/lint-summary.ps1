param(
  [int]$Top = 10,
  [string]$JsonOutputPath,
  [switch]$IncludeMessages,
  [switch]$FailOnWarnings
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$eslintBinary = Join-Path $repoRoot 'node_modules/.bin/eslint.cmd'

if (-not (Test-Path $eslintBinary)) {
  throw "Could not find ESLint binary at $eslintBinary"
}

$lintScopes = @(
  @{
    Name = 'api'
    Config = 'apps/api/eslint.config.mjs'
    Patterns = @(
      'apps/api/src/**/*.ts',
      'apps/api/test/**/*.ts'
    )
  },
  @{
    Name = 'web'
    Config = 'apps/web/eslint.config.mjs'
    Patterns = @(
      'apps/web/src/**/*.{ts,tsx}'
    )
  },
  @{
    Name = 'packages'
    Config = 'eslint.config.mjs'
    Patterns = @(
      'packages/**/*.{ts,tsx}'
    )
  }
)

function Get-NonNullNumber {
  param(
    [object]$Value
  )

  if ($null -eq $Value) {
    return 0
  }

  return [int]$Value
}

function Get-PropertySum {
  param(
    [object[]]$Rows,
    [string]$Property
  )

  if ($null -eq $Rows -or $Rows.Count -eq 0) {
    return 0
  }

  $measurement = $Rows | Measure-Object -Property $Property -Sum
  if ($null -eq $measurement -or $null -eq $measurement.Sum) {
    return 0
  }

  return [int]$measurement.Sum
}

function Test-IsTestFile {
  param(
    [string]$RelativePath
  )

  $normalized = $RelativePath.Replace('\', '/').ToLowerInvariant()
  if ($normalized -match '(?:^|[\\/])(test|tests|__tests__|e2e)(?:[\\/]|$)') {
    return $true
  }

  if ($normalized -match '\.(spec|test|e2e-spec)\.(ts|tsx|js|jsx|mts|cts)$') {
    return $true
  }

  return $false
}

function Get-FileLineCount {
  param(
    [string]$AbsolutePath,
    [hashtable]$LineCountCache
  )

  if ($LineCountCache.ContainsKey($AbsolutePath)) {
    return [int]$LineCountCache[$AbsolutePath]
  }

  if (-not (Test-Path $AbsolutePath)) {
    $LineCountCache[$AbsolutePath] = 0
    return 0
  }

  $lineCount = @((Get-Content -Path $AbsolutePath)).Count
  $LineCountCache[$AbsolutePath] = $lineCount
  return $lineCount
}

function Get-LintCommandArguments {
  param(
    [hashtable]$Scope
  )

  $args = @(
    '--config',
    $Scope.Config,
    '--format',
    'json',
    '--cache',
    '--cache-location',
    "node_modules/.cache/eslint/summary-$($Scope.Name).cache"
  )

  foreach ($pattern in $Scope.Patterns) {
    $args += $pattern
  }

  return $args
}

function Invoke-LintScope {
  param(
    [hashtable]$Scope,
    [string]$RootPath,
    [string]$BinaryPath,
    [switch]$AttachMessages
  )

  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()

  try {
    $commandArgs = Get-LintCommandArguments -Scope $Scope
    & $BinaryPath @commandArgs 1> $stdoutPath 2> $stderrPath
    $exitCode = $LASTEXITCODE
    $stdout = Get-Content -Path $stdoutPath -Raw
    $stderr = Get-Content -Path $stderrPath -Raw

    if ([string]::IsNullOrWhiteSpace($stdout)) {
      if ($exitCode -eq 0) {
        return @()
      }

      throw "Lint scope '$($Scope.Name)' produced no JSON output. $stderr"
    }

    $results = @($stdout | ConvertFrom-Json)
    $scopeRows = @()

    foreach ($result in $results) {
      $messages = @($result.messages)
      $errors = @($messages | Where-Object severity -eq 2).Count
      $warnings = @($messages | Where-Object severity -eq 1).Count
      $total = $errors + $warnings

      if ($total -eq 0) {
        continue
      }

      $topRules = @(
        $messages |
          Where-Object { -not [string]::IsNullOrWhiteSpace($_.ruleId) } |
          Group-Object -Property ruleId |
          Sort-Object -Property Count -Descending |
          Select-Object -First 3 |
          ForEach-Object { "{0} x{1}" -f $_.Name, $_.Count }
      )

      $relativePath = [System.IO.Path]::GetRelativePath($RootPath, [string]$result.filePath)
      $isTestFile = Test-IsTestFile -RelativePath $relativePath
      $row = [pscustomobject]@{
        Scope = $Scope.Name
        File = $relativePath.Replace('\', '/')
        IsTest = $isTestFile
        Errors = $errors
        Warnings = $warnings
        Fixable = Get-NonNullNumber ($result.fixableErrorCount + $result.fixableWarningCount)
        Total = $total
        TopRules = ($topRules -join ', ')
      }

      if ($AttachMessages) {
        $sampleMessages = @(
          $messages |
            Select-Object -First 5 |
            ForEach-Object {
              [pscustomobject]@{
                Line = Get-NonNullNumber $_.line
                Column = Get-NonNullNumber $_.column
                Severity = if ($_.severity -eq 2) { 'error' } else { 'warning' }
                Rule = $_.ruleId
                Message = $_.message
              }
            }
        )
        $row | Add-Member -NotePropertyName SampleMessages -NotePropertyValue $sampleMessages
      }

      $scopeRows += $row
    }

    return $scopeRows
  }
  finally {
    Remove-Item -Path $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
  }
}

Push-Location $repoRoot

try {
  $allRows = @()
  $lineCountCache = @{}

  foreach ($scope in $lintScopes) {
    $allRows += Invoke-LintScope -Scope $scope -RootPath $repoRoot -BinaryPath $eslintBinary -AttachMessages:$IncludeMessages
  }

  $totals = [pscustomobject]@{
    FilesWithProblems = @($allRows).Count
    Errors = Get-PropertySum -Rows $allRows -Property 'Errors'
    Warnings = Get-PropertySum -Rows $allRows -Property 'Warnings'
    Fixable = Get-PropertySum -Rows $allRows -Property 'Fixable'
  }

  $scopeSummary = @(
    $allRows |
      Group-Object -Property Scope |
      Sort-Object -Property Name |
      ForEach-Object {
        [pscustomobject]@{
          Scope = $_.Name
          Files = $_.Count
          Errors = Get-PropertySum -Rows $_.Group -Property 'Errors'
          Warnings = Get-PropertySum -Rows $_.Group -Property 'Warnings'
          Fixable = Get-PropertySum -Rows $_.Group -Property 'Fixable'
        }
      }
  )

  $worstFiles = @(
    $allRows |
      Sort-Object -Property @{ Expression = 'Total'; Descending = $true }, @{ Expression = 'Errors'; Descending = $true }, @{ Expression = 'Warnings'; Descending = $true }, @{ Expression = 'File'; Descending = $false } |
      Select-Object -First $Top
  )

  $nonTestRows = @($allRows | Where-Object { -not $_.IsTest })

  $worstNonTestFiles = @(
    $nonTestRows |
      Sort-Object -Property @{ Expression = 'Total'; Descending = $true }, @{ Expression = 'Errors'; Descending = $true }, @{ Expression = 'Warnings'; Descending = $true }, @{ Expression = 'File'; Descending = $false } |
      Select-Object -First $Top
  )

  $largestNonTestFiles = @(
    $nonTestRows |
      ForEach-Object {
        $absolutePath = Join-Path $repoRoot $_.File
        [pscustomobject]@{
          Scope = $_.Scope
          File = $_.File
          LineCount = Get-FileLineCount -AbsolutePath $absolutePath -LineCountCache $lineCountCache
          Errors = $_.Errors
          Warnings = $_.Warnings
          Fixable = $_.Fixable
          Total = $_.Total
          TopRules = $_.TopRules
        }
      } |
      Sort-Object -Property @{ Expression = 'LineCount'; Descending = $true }, @{ Expression = 'Total'; Descending = $true }, @{ Expression = 'Errors'; Descending = $true }, @{ Expression = 'File'; Descending = $false } |
      Select-Object -First $Top
  )

  $ruleTotals = @(
    $allRows |
      ForEach-Object {
        foreach ($part in ($_.TopRules -split ', ')) {
          if ([string]::IsNullOrWhiteSpace($part)) {
            continue
          }

          $segments = $part -split ' x', 2
          if ($segments.Count -ne 2) {
            continue
          }

          [pscustomobject]@{
            Rule = $segments[0]
            Count = [int]$segments[1]
          }
        }
      } |
      Group-Object -Property Rule |
      ForEach-Object {
        [pscustomobject]@{
          Rule = $_.Name
          Count = Get-PropertySum -Rows $_.Group -Property 'Count'
        }
      } |
      Sort-Object -Property Count -Descending |
      Select-Object -First 10
  )

  Write-Host ''
  Write-Host 'Repo lint summary'
  Write-Host ('Files with problems: {0}' -f $totals.FilesWithProblems)
  Write-Host ('Errors: {0} | Warnings: {1} | Fixable: {2}' -f $totals.Errors, $totals.Warnings, $totals.Fixable)

  if ($scopeSummary.Count -gt 0) {
    Write-Host ''
    Write-Host 'By scope'
    $scopeSummary | Format-Table -AutoSize | Out-Host
  }

  if ($worstFiles.Count -gt 0) {
    Write-Host ''
    Write-Host ('Top {0} worst files' -f $worstFiles.Count)
    $worstFiles |
      Select-Object Scope, File, Errors, Warnings, Fixable, Total, TopRules |
      Format-Table -Wrap -AutoSize |
      Out-Host
  }

  if ($worstNonTestFiles.Count -gt 0) {
    Write-Host ''
    Write-Host ('Top {0} worst non-test files' -f $worstNonTestFiles.Count)
    $worstNonTestFiles |
      Select-Object Scope, File, Errors, Warnings, Fixable, Total, TopRules |
      Format-Table -Wrap -AutoSize |
      Out-Host
  }

  if ($largestNonTestFiles.Count -gt 0) {
    Write-Host ''
    Write-Host ('Top {0} largest non-test files' -f $largestNonTestFiles.Count)
    $largestNonTestFiles |
      Select-Object Scope, File, LineCount, Errors, Warnings, Fixable, Total, TopRules |
      Format-Table -Wrap -AutoSize |
      Out-Host
  }

  if ($ruleTotals.Count -gt 0) {
    Write-Host ''
    Write-Host 'Top rules'
    $ruleTotals | Format-Table -AutoSize | Out-Host
  }

  if ($JsonOutputPath) {
    $report = [pscustomobject]@{
      generatedAt = (Get-Date).ToString('o')
      totals = $totals
      scopes = $scopeSummary
      worstFiles = $worstFiles
      worstNonTestFiles = $worstNonTestFiles
      largestNonTestFiles = $largestNonTestFiles
      topRules = $ruleTotals
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -Path $JsonOutputPath
    Write-Host ''
    Write-Host ('Wrote JSON report to {0}' -f $JsonOutputPath)
  }

  if ($totals.Errors -gt 0 -or ($FailOnWarnings -and $totals.Warnings -gt 0)) {
    exit 1
  }
}
finally {
  Pop-Location
}