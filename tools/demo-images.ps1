# 生成演示用的“宠物照片”（渐变 + 爪印 + 文案），输出到 data/demo/
# 用法（执行策略受限时）：$ps1 = Get-Content tools\demo-images.ps1 -Raw; Invoke-Expression $ps1
Add-Type -AssemblyName System.Drawing

$root = if ($PSScriptRoot) { Join-Path $PSScriptRoot '..' } else { (Get-Location).Path }
$outDir = (Resolve-Path $root).Path
$outDir = Join-Path $outDir 'data\demo'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-DemoImage {
  param([string]$File, [string]$Title, [string]$Sub, [string]$C1, [string]$C2, [string]$Ink, [int]$W = 900, [int]$H = 1120)

  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'ClearTypeGridFit'

  $rect = [System.Drawing.Rectangle]::new(0, 0, $W, $H)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, ([System.Drawing.ColorTranslator]::FromHtml($C1)), ([System.Drawing.ColorTranslator]::FromHtml($C2)), 45.0)
  $g.FillRectangle($grad, $rect)

  $rnd = New-Object System.Random(7)
  for ($i = 0; $i -lt 9; $i++) {
    $r = $rnd.Next(60, 220)
    $x = $rnd.Next(0, $W)
    $y = $rnd.Next(0, $H)
    $c = [System.Drawing.Color]::FromArgb($rnd.Next(18, 46), 255, 255, 255)
    $br = New-Object System.Drawing.SolidBrush($c)
    $g.FillEllipse($br, ($x - $r), ($y - $r), ($r * 2), ($r * 2))
    $br.Dispose()
  }

  $inkColor = [System.Drawing.ColorTranslator]::FromHtml($Ink)
  $pawInk = [System.Drawing.Color]::FromArgb(40, $inkColor)
  $pb = New-Object System.Drawing.SolidBrush($pawInk)
  $cx = $W / 2
  $cy = $H * 0.44
  $g.FillEllipse($pb, [int]($cx - 150), [int]($cy - 40), 300, 260)
  $toes = @(@(-190, -140, 80, 100), @(-70, -218, 76, 96), @(56, -212, 76, 96), @(160, -132, 80, 100))
  foreach ($t in $toes) {
    $g.FillEllipse($pb, [int]($cx + $t[0]), [int]($cy + $t[1]), $t[2], $t[3])
  }
  $pb.Dispose()

  $titleFont = New-Object System.Drawing.Font('Microsoft YaHei', 66, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $subFont = New-Object System.Drawing.Font('Microsoft YaHei', 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $inkBrush = New-Object System.Drawing.SolidBrush($inkColor)
  $softBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(170, $inkColor))
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'

  $r1 = [System.Drawing.RectangleF]::new([single]0, [single]($H * 0.70), [single]$W, [single]120)
  $r2 = [System.Drawing.RectangleF]::new([single]0, [single]($H * 0.70 + 118), [single]$W, [single]80)
  $g.DrawString($Title, $titleFont, $inkBrush, $r1, $fmt)
  $g.DrawString($Sub, $subFont, $softBrush, $r2, $fmt)

  $path = Join-Path $outDir $File
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $softBrush.Dispose(); $inkBrush.Dispose(); $titleFont.Dispose(); $subFont.Dispose(); $grad.Dispose(); $g.Dispose(); $bmp.Dispose()
  Write-Host "wrote $path"
}

New-DemoImage -File 'dou1.png' -Title '豆豆' -Sub '今天走了 3 圈，尾巴没停过' -C1 '#FDEDE4' -C2 '#F7D9C8' -Ink '#F2643F'
New-DemoImage -File 'dou2.png' -Title '晒晒太阳' -Sub '窗台是它的王座' -C1 '#FFF6E3' -C2 '#F6E3BE' -Ink '#B07C34'
New-DemoImage -File 'mi1.png' -Title '奶糖' -Sub '一岁啦，还是那颗小奶糖' -C1 '#EFF4EC' -C2 '#D8E6D2' -Ink '#5C7A52'
New-DemoImage -File 'mi2.png' -Title '贴纸测试' -Sub '相框 + 贴纸组合' -C1 '#F3EDF9' -C2 '#DED0EE' -Ink '#6E4F9C'

# 透明贴纸：爪印
$st = New-Object System.Drawing.Bitmap(400, 400)
$sg = [System.Drawing.Graphics]::FromImage($st)
$sg.SmoothingMode = 'AntiAlias'
$sg.Clear([System.Drawing.Color]::Transparent)
$sBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#F2643F'))
$sg.FillEllipse($sBrush, 120, 180, 160, 150)
foreach ($t in @(@(66, 96, 60, 76), @(140, 46, 58, 74), @(214, 52, 58, 74), @(276, 100, 60, 76))) {
  $sg.FillEllipse($sBrush, $t[0], $t[1], $t[2], $t[3])
}
$sBrush.Dispose()
$stPath = Join-Path $outDir 'sticker.png'
$st.Save($stPath, [System.Drawing.Imaging.ImageFormat]::Png)
$sg.Dispose(); $st.Dispose()
Write-Host "wrote $stPath"
