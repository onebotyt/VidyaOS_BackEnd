$port = New-Object System.IO.Ports.SerialPort "COM5", 115200, None, 8, One
$port.ReadTimeout = 1000
try {
    $port.Open()
    # Drain stale buffered bytes from earlier
    $port.DiscardInBuffer()
    Write-Host "Opened COM5 and drained old buffer. Listening for 6 seconds..."
    $endTime = (Get-Date).AddSeconds(6)
    while ((Get-Date) -lt $endTime) {
        try {
            $line = $port.ReadLine()
            Write-Host $line
        } catch [System.TimeoutException] {
            # continue
        }
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
} finally {
    if ($port.IsOpen) {
        $port.Close()
        Write-Host "Closed COM5."
    }
}
