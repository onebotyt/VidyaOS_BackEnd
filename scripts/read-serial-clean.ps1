$port = New-Object System.IO.Ports.SerialPort "COM5", 115200, None, 8, One
$port.ReadTimeout = 500
$port.Open()

# Read until buffer is completely drained
try {
    while ($true) {
        $buf = $port.ReadExisting()
        if ([string]::IsNullOrEmpty($buf)) { break }
    }
} catch {}

Write-Host "Buffer cleared. Reading new live data for 8 seconds..."
$endTime = (Get-Date).AddSeconds(8)
while ((Get-Date) -lt $endTime) {
    try {
        $line = $port.ReadLine()
        Write-Host $line
    } catch [System.TimeoutException] {
        # timeout, continue
    }
}

$port.Close()
Write-Host "Done."
