#Requires -Version 5.1
# =============================================================================
# frpmgrd 一键安装脚本 (frp-manager-server) — Windows / PowerShell 版
#
#   支持: Windows 10/11 / Windows Server (amd64 / arm64)
#   服务: 通过 NSSM 将 frpmgrd.exe 包装为真正的 Windows 服务 (可在 services.msc 管理)
#   功能: 自动识别架构 -> 下载二进制 -> 安装 -> 注册服务 -> 开机自启 -> 健康检查
#
# 一行安装 (推荐, 管理员 PowerShell 中执行):
#   irm https://raw.githubusercontent.com/mia-clark/frp-manager-server/main/scripts/install.ps1 | iex
#
# 非交互 / 自定义示例 (先把脚本下到本地):
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Yes -Port 9000 -Token mysecret
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Port random
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
#
# 环境变量 (等价于参数, 便于自动化):
#   $env:FRPMGR_PORT=9000; $env:FRPMGR_API_TOKEN='xxx'; $env:FRPMGR_VERSION='v1.2.14'; $env:ASSUME_YES=1
# =============================================================================

[CmdletBinding()]
param(
    [Alias('p')][string]$Port    = $env:FRPMGR_PORT,
    [Alias('t')][string]$Token   = $env:FRPMGR_API_TOKEN,
    [Alias('v')][string]$Version = $env:FRPMGR_VERSION,
    [Alias('y')][switch]$Yes,
    [Alias('u')][switch]$Update,
    [Alias('f')][switch]$Force,
    [switch]$Uninstall,
    [Alias('h')][switch]$Help
)

$ErrorActionPreference = 'Stop'

# ----------------------------------------------------------------------------
# 常量配置
# ----------------------------------------------------------------------------
$Repo         = 'mia-clark/frp-manager-server'
$BinName      = 'frpmgrd.exe'
$ServiceName  = 'frpmgrd'
$DisplayName  = 'frpmgrd - FRP Manager Server'
$DefaultPort  = '8080'
$InstallDir   = Join-Path $env:ProgramFiles 'frpmgrd'        # 二进制 + nssm.exe
$DataDir      = Join-Path $env:ProgramData  'frpmgrd\data'   # 运行数据
$LogDir       = Join-Path $env:ProgramData  'frpmgrd\logs'   # 服务日志
$NssmVersion  = '2.24'
$NssmZipUrl   = "https://nssm.cc/release/nssm-$NssmVersion.zip"

# 运行期填充
$script:Arch        = ''
$script:BinPath     = Join-Path $InstallDir $BinName
$script:NssmPath    = Join-Path $InstallDir 'nssm.exe'
$script:TokenSource = ''
$script:TmpDir      = ''

if ($env:ASSUME_YES -eq '1') { $Yes = $true }

# ----------------------------------------------------------------------------
# 输出辅助 (带颜色)
# ----------------------------------------------------------------------------
function Write-Info { param([string]$m) Write-Host '[*] ' -ForegroundColor Blue   -NoNewline; Write-Host $m }
function Write-Ok   { param([string]$m) Write-Host '[+] ' -ForegroundColor Green  -NoNewline; Write-Host $m }
function Write-Warn { param([string]$m) Write-Host '[!] ' -ForegroundColor Yellow -NoNewline; Write-Host $m }
function Write-Err  { param([string]$m) Write-Host '[x] ' -ForegroundColor Red    -NoNewline; Write-Host $m }
function Die        { param([string]$m) Write-Err $m; Cleanup; exit 1 }

function Cleanup {
    if ($script:TmpDir -and (Test-Path $script:TmpDir)) {
        Remove-Item -Recurse -Force $script:TmpDir -ErrorAction SilentlyContinue
    }
}

# ----------------------------------------------------------------------------
# 帮助
# ----------------------------------------------------------------------------
function Show-Usage {
    Write-Host @"
frpmgrd 一键安装脚本 (Windows)

用法: powershell -ExecutionPolicy Bypass -File install.ps1 [选项]

选项:
  -Port <端口>     指定监听端口; 传 "random" 表示随机端口; 省略则交互/默认 $DefaultPort
  -Token <令牌>    指定 API 令牌; 省略则交互输入, 留空则生成强随机令牌
  -Version <版本>  指定版本 (如 v1.2.14); 省略则安装最新版
  -Yes             非交互模式, 端口用默认值、令牌自动随机生成
  -Update          全自动更新到最新版 (保留现有端口/令牌/数据, 仅换二进制并重启)
  -Force           配合 -Update: 即使已是最新版也强制重装
  -Uninstall       卸载 (停止/删除服务 + 删除二进制)
  -Help            显示帮助

示例:
  install.ps1                              # 全交互: 逐项询问端口/令牌
  install.ps1 -Port 9000                   # 指定端口, 仅询问令牌
  install.ps1 -Port 9000 -Token secret -Yes  # 完全静默安装
  install.ps1 -Port random                 # 随机端口
  install.ps1 -Version v1.2.14 -Port 8888  # 指定版本+端口
  install.ps1 -Update                      # 全自动更新到最新版
  install.ps1 -Update -Force               # 强制重装当前最新版
  install.ps1 -Uninstall                   # 卸载
"@
}

# ----------------------------------------------------------------------------
# 管理员检测 + 自动 UAC 自提权
# ----------------------------------------------------------------------------
function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Admin {
    if (Test-Admin) { return }

    # 仅在以本地脚本文件运行时才能自提权; 管道 (irm|iex) 场景拿不到脚本路径
    if ($PSCommandPath) {
        Write-Info '需要管理员权限, 正在尝试通过 UAC 提权重新运行...'
        $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
        foreach ($kv in $PSBoundParameters.GetEnumerator()) {
            if ($kv.Value -is [switch]) {
                if ($kv.Value.IsPresent) { $argList += "-$($kv.Key)" }
            } else {
                $argList += "-$($kv.Key)"; $argList += "`"$($kv.Value)`""
            }
        }
        try {
            Start-Process -FilePath (Get-Process -Id $PID).Path -Verb RunAs -ArgumentList $argList
        } catch {
            Die '提权被取消或失败。请右键“以管理员身份运行” PowerShell 后重试。'
        }
        exit 0
    }

    Die '需要管理员权限。请在【管理员 PowerShell】中运行本脚本 (右键 PowerShell -> 以管理员身份运行)。'
}

# ----------------------------------------------------------------------------
# 网络初始化 (启用 TLS1.2, 关闭进度条以加速下载)
# ----------------------------------------------------------------------------
function Initialize-Net {
    try {
        [Net.ServicePointManager]::SecurityProtocol = `
            [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11
    } catch { }
    $script:OldProgress = $ProgressPreference
    $global:ProgressPreference = 'SilentlyContinue'
}

# ----------------------------------------------------------------------------
# 平台探测: 架构
# ----------------------------------------------------------------------------
function Get-Platform {
    switch ($env:PROCESSOR_ARCHITECTURE) {
        'AMD64' { $script:Arch = 'amd64' }
        'ARM64' { $script:Arch = 'arm64' }
        'x86'   {
            # 32 位进程也可能跑在 64 位系统上, 以系统位数为准
            if ([Environment]::Is64BitOperatingSystem) { $script:Arch = 'amd64' }
            else { Die '不支持 32 位 Windows (仅提供 amd64 / arm64 版本)' }
        }
        default {
            if ([Environment]::Is64BitOperatingSystem) { $script:Arch = 'amd64' }
            else { Die "无法识别的 CPU 架构: $($env:PROCESSOR_ARCHITECTURE)" }
        }
    }
    Write-Info "检测到平台: windows/$($script:Arch)"
}

# ----------------------------------------------------------------------------
# 交互读取: 返回输入值, 非交互/静默则用默认值
# ----------------------------------------------------------------------------
function Read-Prompt {
    param([string]$Message, [string]$Default = '')
    if ($Yes) { return $Default }
    if ($Default) { $hint = " [$Default]" } else { $hint = '' }
    $r = Read-Host -Prompt "? $Message$hint"
    if ([string]::IsNullOrEmpty($r)) { return $Default }
    return $r
}

# ----------------------------------------------------------------------------
# 生成随机令牌 / 随机端口 / 端口校验
# ----------------------------------------------------------------------------
function New-Token {
    $bytes = New-Object byte[] 24
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function New-RandomPort { Get-Random -Minimum 20000 -Maximum 60000 }

function Test-Port {
    param([string]$P)
    if ($P -notmatch '^\d+$') { return $false }
    $n = [int]$P
    return ($n -ge 1 -and $n -le 65535)
}

# ----------------------------------------------------------------------------
# 下载文件
# ----------------------------------------------------------------------------
function Get-RemoteFile {
    param([string]$Url, [string]$Dest)
    Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -Headers @{ 'User-Agent' = 'frpmgrd-installer' }
}

# ----------------------------------------------------------------------------
# 解析目标版本 (GitHub API), 失败则提示手动指定
# ----------------------------------------------------------------------------
function Resolve-Version {
    if ($Version) {
        if ($Version -notmatch '^v') { $script:Version = "v$Version" } else { $script:Version = $Version }
        Write-Info "使用指定版本: $($script:Version)"
        return
    }
    Write-Info '正在查询最新版本...'
    try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" `
            -Headers @{ 'User-Agent' = 'frpmgrd-installer' } -UseBasicParsing
        $script:Version = $rel.tag_name
    } catch {
        Die '无法获取最新版本, 请用 -Version 手动指定 (如 -Version v1.2.14)'
    }
    if (-not $script:Version) { Die '无法解析最新版本号, 请用 -Version 手动指定' }
    Write-Ok "最新版本: $($script:Version)"
}

# ----------------------------------------------------------------------------
# 决定端口与令牌 (交互 / 默认 / 随机)
# ----------------------------------------------------------------------------
function Resolve-Port {
    if ($Port -eq 'random') {
        $script:Port = "$(New-RandomPort)"
        Write-Ok "已生成随机端口: $($script:Port)"
        return
    }
    if (-not $Port) {
        $script:Port = Read-Prompt "请输入监听端口 (回车=默认 $DefaultPort, 输入 r=随机)" $DefaultPort
    } else {
        $script:Port = $Port
    }
    if ($script:Port -eq 'r' -or $script:Port -eq 'random') {
        $script:Port = "$(New-RandomPort)"
        Write-Ok "已生成随机端口: $($script:Port)"
    }
    if (-not (Test-Port $script:Port)) { Die "端口非法: '$($script:Port)' (应为 1-65535)" }
    Write-Info "监听端口: $($script:Port)"
}

function Resolve-Token {
    if ($Token) {
        $script:Token = $Token
        $script:TokenSource = '命令行/环境变量指定'
    } elseif (-not $Yes) {
        $r = Read-Prompt '请输入 API 令牌 (后台访问凭证, 回车=自动生成强随机令牌)' ''
        if ($r) { $script:Token = $r; $script:TokenSource = '手动输入' }
    }
    if (-not $script:Token) {
        $script:Token = New-Token
        $script:TokenSource = '自动生成'
        Write-Ok '已自动生成强随机 API 令牌'
    } else {
        Write-Info "API 令牌: $($script:TokenSource)"
    }
}

# ----------------------------------------------------------------------------
# 安装前确认
# ----------------------------------------------------------------------------
function Confirm-Install {
    Write-Host ''
    Write-Host '即将安装, 请确认以下信息:' -ForegroundColor White
    Write-Host ("  平台      : windows/{0}" -f $script:Arch)
    Write-Host ("  版本      : {0}" -f $script:Version)
    Write-Host ("  监听端口  : {0}" -f $script:Port)
    Write-Host ("  API 令牌  : {0}  ({1})" -f $script:Token, $script:TokenSource)
    Write-Host ("  安装目录  : {0}" -f $script:BinPath)
    Write-Host ("  数据目录  : {0}" -f $DataDir)
    Write-Host ''
    if ($Yes) { return }
    $r = Read-Prompt '确认继续? [Y/n]' 'Y'
    if ($r -match '^(n|no)$') { Die '已取消安装' }
}

# ----------------------------------------------------------------------------
# 下载并安装 frpmgrd 二进制
# ----------------------------------------------------------------------------
function Install-Binary {
    $verNum = $script:Version.TrimStart('v')
    $asset  = "frpmgrd_${verNum}_windows_$($script:Arch).zip"
    $url    = "https://github.com/$Repo/releases/download/$($script:Version)/$asset"

    $script:TmpDir = Join-Path $env:TEMP ("frpmgr_" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $script:TmpDir | Out-Null

    $zipPath = Join-Path $script:TmpDir $asset
    Write-Info "下载: $url"
    try { Get-RemoteFile -Url $url -Dest $zipPath } catch { Die "下载失败, 请检查网络或版本号: $_" }

    Write-Info '解压安装包...'
    $extractDir = Join-Path $script:TmpDir 'extract'
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    $exe = Get-ChildItem -Path $extractDir -Filter $BinName -Recurse | Select-Object -First 1
    if (-not $exe) { Die "安装包中未找到 $BinName" }

    Write-Info "安装到 $($script:BinPath)"
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -Path $exe.FullName -Destination $script:BinPath -Force
    try {
        $ver = & $script:BinPath version 2>$null
        Write-Ok "二进制安装完成: $ver"
    } catch {
        Write-Ok "二进制安装完成: $($script:BinPath)"
    }
}

# ----------------------------------------------------------------------------
# 下载并就绪 NSSM (服务包装器)
# ----------------------------------------------------------------------------
function Install-Nssm {
    if (Test-Path $script:NssmPath) { return }   # 已存在则复用
    Write-Info "下载服务管理器 NSSM v$NssmVersion ..."
    if (-not $script:TmpDir) {
        $script:TmpDir = Join-Path $env:TEMP ("frpmgr_" + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path $script:TmpDir | Out-Null
    }
    $nssmZip = Join-Path $script:TmpDir 'nssm.zip'
    try { Get-RemoteFile -Url $NssmZipUrl -Dest $nssmZip } catch { Die "NSSM 下载失败 ($NssmZipUrl): $_" }

    $nssmDir = Join-Path $script:TmpDir 'nssm'
    Expand-Archive -Path $nssmZip -DestinationPath $nssmDir -Force
    # NSSM 仅提供 win32/win64; arm64 通过 x64 模拟运行 win64 版本
    $sub = if ([Environment]::Is64BitOperatingSystem) { 'win64' } else { 'win32' }
    $src = Get-ChildItem -Path $nssmDir -Filter 'nssm.exe' -Recurse |
        Where-Object { $_.DirectoryName -like "*\$sub" } | Select-Object -First 1
    if (-not $src) { $src = Get-ChildItem -Path $nssmDir -Filter 'nssm.exe' -Recurse | Select-Object -First 1 }
    if (-not $src) { Die 'NSSM 压缩包中未找到 nssm.exe' }

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -Path $src.FullName -Destination $script:NssmPath -Force
    Write-Ok 'NSSM 就绪'
}

# 服务是否已存在
function Test-Service {
    return [bool](Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
}

# 静默移除已存在的服务 (用于重装前清理)
function Remove-ServiceIfExists {
    if (Test-Service) {
        & $script:NssmPath stop $ServiceName 2>$null | Out-Null
        & $script:NssmPath remove $ServiceName confirm 2>$null | Out-Null
        Start-Sleep -Milliseconds 500
    }
}

# ----------------------------------------------------------------------------
# 注册 / 配置服务 (NSSM)
# ----------------------------------------------------------------------------
function Register-FrpmgrService {
    Write-Info "注册 Windows 服务: $ServiceName"
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    New-Item -ItemType Directory -Force -Path $LogDir  | Out-Null

    Remove-ServiceIfExists

    & $script:NssmPath install $ServiceName $script:BinPath serve | Out-Null
    & $script:NssmPath set $ServiceName DisplayName  $DisplayName | Out-Null
    & $script:NssmPath set $ServiceName Description   "frpmgrd - headless FRP client manager daemon" | Out-Null
    & $script:NssmPath set $ServiceName AppDirectory  $InstallDir | Out-Null
    & $script:NssmPath set $ServiceName Start         'SERVICE_AUTO_START' | Out-Null

    # 环境变量注入 (等价于 systemd EnvironmentFile)
    $envPairs = @(
        "FRPMGR_API_TOKEN=$($script:Token)",
        "FRPMGR_HTTP_ADDR=:$($script:Port)",
        "FRPMGR_DATA_DIR=$DataDir",
        "FRPMGR_LOG_LEVEL=info",
        "FRPMGR_CORS_ORIGINS=*",
        "FRPMGR_DOCS_ENABLED=true"
    )
    & $script:NssmPath set $ServiceName AppEnvironmentExtra @envPairs | Out-Null

    # 日志与崩溃自动重启
    & $script:NssmPath set $ServiceName AppStdout   (Join-Path $LogDir 'frpmgrd.log') | Out-Null
    & $script:NssmPath set $ServiceName AppStderr   (Join-Path $LogDir 'frpmgrd.log') | Out-Null
    & $script:NssmPath set $ServiceName AppRotateFiles 1 | Out-Null
    & $script:NssmPath set $ServiceName AppRotateBytes 10485760 | Out-Null
    & $script:NssmPath set $ServiceName AppExit Default Restart | Out-Null
    & $script:NssmPath set $ServiceName AppRestartDelay 5000 | Out-Null

    & $script:NssmPath start $ServiceName | Out-Null
    Write-Ok '服务已注册、启动并设置为开机自启'
}

# 从已注册服务读取监听端口 (用于更新后健康检查)
function Get-ServicePort {
    if (-not (Test-Service)) { return '' }
    $raw = & $script:NssmPath get $ServiceName AppEnvironmentExtra 2>$null
    $line = $raw | Where-Object { $_ -match '^FRPMGR_HTTP_ADDR=' } | Select-Object -First 1
    if ($line) { return ($line -split '=', 2)[1].TrimStart(':') }
    return ''
}

# 重启已有服务 (仅加载新二进制, 不改配置)
function Restart-FrpmgrService {
    if (Test-Service) {
        & $script:NssmPath restart $ServiceName | Out-Null
        Write-Ok '服务已重启'
    } else {
        Write-Warn '未发现已注册的服务, 跳过重启 (可重新安装以注册服务)'
    }
}

# ----------------------------------------------------------------------------
# 读取已安装二进制版本号 (如 1.2.14), 未安装则为空
# ----------------------------------------------------------------------------
function Get-InstalledVersion {
    if (Test-Path $script:BinPath) {
        $out = & $script:BinPath version 2>$null
        if ($out -match 'frpmgrd\s+(\S+)') { return $Matches[1] }
    }
    return ''
}

# ----------------------------------------------------------------------------
# 健康检查
# ----------------------------------------------------------------------------
function Invoke-HealthCheck {
    Write-Info '等待服务就绪...'
    for ($i = 0; $i -lt 10; $i++) {
        & $script:BinPath health -addr "http://127.0.0.1:$($script:Port)" 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Ok '服务健康检查通过 ✓'
            return
        }
        Start-Sleep -Seconds 1
    }
    Write-Warn '健康检查未通过 (服务可能仍在启动)。请稍后用 services.msc 查看服务状态与日志。'
}

# ----------------------------------------------------------------------------
# 安装总流程
# ----------------------------------------------------------------------------
function Invoke-Install {
    Write-Host '=== frpmgrd 一键安装 (Windows) ===' -ForegroundColor White
    Get-Platform
    Resolve-Version
    Resolve-Port
    Resolve-Token
    Confirm-Install
    Install-Binary
    Install-Nssm
    Register-FrpmgrService
    Invoke-HealthCheck
    Write-Summary
}

function Write-Summary {
    $ip = '127.0.0.1'
    Write-Host ''
    Write-Host '✓ 安装完成!' -ForegroundColor Green
    Write-Host '────────────────────────────────────────────'
    Write-Host ("  访问地址 : http://{0}:{1}" -f $ip, $script:Port)
    Write-Host ("  API 文档 : http://{0}:{1}/api/docs" -f $ip, $script:Port)
    Write-Host ("  API 令牌 : {0}" -f $script:Token)
    Write-Host ("  安装目录 : {0}" -f $InstallDir)
    Write-Host ("  数据目录 : {0}" -f $DataDir)
    Write-Host ("  日志目录 : {0}" -f $LogDir)
    Write-Host '────────────────────────────────────────────'
    Write-Host ("  状态: services.msc  或  sc query {0}" -f $ServiceName)
    Write-Host ("  日志: Get-Content -Wait '{0}'" -f (Join-Path $LogDir 'frpmgrd.log'))
    Write-Host ("  停止: nssm stop {0}   启动: nssm start {0}" -f $ServiceName)
    Write-Host ("  更新: install.ps1 -Update")
    Write-Host ("  卸载: install.ps1 -Uninstall")
    Write-Host '────────────────────────────────────────────'
    Write-Warn '请妥善保存 API 令牌, 它是访问后台的唯一凭证!'
}

# ----------------------------------------------------------------------------
# 全自动更新流程 (保留现有端口/令牌/数据, 仅替换二进制并重启)
# ----------------------------------------------------------------------------
function Invoke-Update {
    Write-Host '=== frpmgrd 全自动更新 (Windows) ===' -ForegroundColor White
    Get-Platform

    if (-not (Test-Path $script:BinPath)) {
        Die "未检测到已安装的 frpmgrd ($($script:BinPath))。请先执行安装, 而非更新。"
    }

    $cur = Get-InstalledVersion
    if ($cur) { Write-Info "当前已安装版本: $cur" } else { Write-Info '当前已安装版本: 未知' }

    Resolve-Version
    $target = $script:Version.TrimStart('v')

    if ($cur -and $cur -eq $target -and -not $Force) {
        Write-Ok "已是最新版本 ($cur), 无需更新。"
        Write-Info '如需强制重装请加 -Force'
        return
    }

    Write-Info "准备更新: $(if ($cur) { $cur } else { '?' }) -> $target"
    # 先停服务再覆盖, 避免 exe 被占用
    if (Test-Service) { & $script:NssmPath stop $ServiceName 2>$null | Out-Null; Start-Sleep -Milliseconds 500 }
    Install-Binary
    Restart-FrpmgrService

    $script:Port = Get-ServicePort
    if ($script:Port) {
        Invoke-HealthCheck
    } else {
        Write-Warn '未能读取到现有端口, 跳过健康检查 (服务应已重启)'
    }

    Write-Host ''
    Write-Host "✓ 更新完成! 版本: $target" -ForegroundColor Green
    if ($script:Port) { Write-Host ("  访问地址 : http://127.0.0.1:{0}" -f $script:Port) }
    Write-Info '现有端口、API 令牌与数据均未改动。'
}

# ----------------------------------------------------------------------------
# 卸载流程
# ----------------------------------------------------------------------------
function Invoke-Uninstall {
    Write-Host '=== frpmgrd 卸载 (Windows) ===' -ForegroundColor White

    if (Test-Path $script:NssmPath) {
        if (Test-Service) {
            & $script:NssmPath stop $ServiceName 2>$null | Out-Null
            & $script:NssmPath remove $ServiceName confirm 2>$null | Out-Null
            Write-Ok '已移除 Windows 服务'
        } else {
            Write-Info '未发现已注册服务, 跳过'
        }
    } elseif (Test-Service) {
        # 没有 nssm.exe 时退而用 sc.exe 删除
        & sc.exe stop $ServiceName 2>$null | Out-Null
        & sc.exe delete $ServiceName 2>$null | Out-Null
        Write-Ok '已移除 Windows 服务'
    }

    if (Test-Path $script:BinPath) {
        Remove-Item -Force $script:BinPath -ErrorAction SilentlyContinue
        Write-Ok "已删除二进制 $($script:BinPath)"
    }

    $r = Read-Prompt "是否同时删除配置与数据目录 ($(Split-Path $DataDir -Parent))? [y/N]" 'N'
    if ($r -match '^(y|yes)$') {
        Remove-Item -Recurse -Force (Split-Path $DataDir -Parent) -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
        Write-Ok '已删除配置与数据'
    } else {
        Write-Info "保留数据目录 $DataDir"
        # 仅清理已无用的 nssm.exe 与空安装目录
        Remove-Item -Force $script:NssmPath -ErrorAction SilentlyContinue
        if ((Test-Path $InstallDir) -and -not (Get-ChildItem $InstallDir -ErrorAction SilentlyContinue)) {
            Remove-Item -Force $InstallDir -ErrorAction SilentlyContinue
        }
    }
    Write-Ok '卸载完成'
}

# ----------------------------------------------------------------------------
# 入口
# ----------------------------------------------------------------------------
function Main {
    if ($Help) { Show-Usage; return }

    # 控制台 UTF-8, 避免中文输出乱码
    try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

    Assert-Admin
    Initialize-Net

    try {
        if ($Uninstall)  { Invoke-Uninstall }
        elseif ($Update) { Invoke-Update }
        else             { Invoke-Install }
    } finally {
        if ($script:OldProgress) { $global:ProgressPreference = $script:OldProgress }
        Cleanup
    }
}

Main
