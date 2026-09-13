# 图标生成脚本：长方形窗口 2x2 网格，深色圆角背景
# 其中一个窗口用品牌蓝强调，其余三个浅色
# 运行：powershell -ExecutionPolicy Bypass -File make-icons.ps1
# 需要 .NET System.Drawing（Windows 自带）

Add-Type -AssemblyName System.Drawing

$OutputDir = Join-Path $PSScriptRoot "icons"
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# 设计基准 512x512，等比缩放输出
$BaseSize = 512
$Sizes = @(16, 32, 48, 128)

# 颜色
$BgColor      = [System.Drawing.Color]::FromArgb(255, 34, 38, 46)    # 深色圆角背景 #22262E
$AccentColor  = [System.Drawing.Color]::FromArgb(255, 43, 125, 233)  # 品牌蓝 #2B7DE9
$WindowColor  = [System.Drawing.Color]::FromArgb(255, 225, 230, 238) # 浅灰白窗口 #E1E6EE

# 窗口布局（相对 512 基准）：长方形 2x2 网格，宽高比 3:2
$GridLeft   = 96.0
$GridTop    = 128.0
$GridWidth  = 320.0   # 网格总宽
$GridHeight = 256.0   # 网格总高（3:2）
$Gap        = 24.0    # 窗格间距
$CellW      = ($GridWidth  - $Gap) / 2.0
$CellH      = ($GridHeight - $Gap) / 2.0
$CornerRadius = 18.0  # 窗格圆角
$BgCornerRadius = 96.0  # 背景圆角

# 强调窗口：右上格
$AccentIndex = 1

function New-RoundedRectPath {
    param([float]$X, [float]$Y, [float]$W, [float]$H, [float]$R)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $R * 2
    $path.AddArc($X, $Y, $d, $d, 180, 90)
    $path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
    $path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
    $path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

foreach ($size in $Sizes) {
    $scale = $size / $BaseSize
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # 背景圆角矩形
    $bgPath = New-RoundedRectPath -X 0 -Y 0 -W $size -H $size -R ($BgCornerRadius * $scale)
    $bgBrush = New-Object System.Drawing.SolidBrush($BgColor)
    $g.FillPath($bgBrush, $bgPath)

    # 4 个窗格
    for ($i = 0; $i -lt 4; $i++) {
        $col = $i % 2
        $row = [math]::Floor($i / 2)
        $x = ($GridLeft + $col * ($CellW + $Gap)) * $scale
        $y = ($GridTop + $row * ($CellH + $Gap)) * $scale
        $w = $CellW * $scale
        $h = $CellH * $scale

        $color = $WindowColor
        if ($i -eq $AccentIndex) { $color = $AccentColor }
        $brush = New-Object System.Drawing.SolidBrush($color)
        $path = New-RoundedRectPath -X $x -Y $y -W $w -H $h -R ($CornerRadius * $scale)
        $g.FillPath($brush, $path)
        $brush.Dispose()
        $path.Dispose()
    }

    $bgBrush.Dispose()
    $bgPath.Dispose()
    $g.Dispose()

    $outPath = Join-Path $OutputDir ("icon{0}.png" -f $size)
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Generated $outPath"
}

Write-Host "All icons generated."
