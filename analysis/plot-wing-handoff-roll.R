# Pipe the --csv output from wing-handoff-roll.js to this script.
data <- read.csv(file("stdin"))
imu <- subset(data, !is.na(main))
model <- subset(data, !is.na(simultaneous))
png("docs/tatsumi-wing-handoff-roll.png", width=1500, height=740, res=145, bg="white")
par(mfrow=c(1,2), mar=c(4.3,4.6,2.5,.7), las=1, mgp=c(2.9,.7,0),
    family=if (Sys.info()[["sysname"]] == "Darwin") "Hiragino Sans" else "sans")
panel <- function(limits, ylabel, title) {
  plot(c(0,10), limits, type="n", bty="l", xaxs="i", xlab="離台後の時間 (秒)",
       ylab=ylabel, main=title, cex.main=1)
  abline(h=axTicks(2), col="#e0e5ea")
  abline(h=0, col="#88929a")
  abline(v=c(2,5), col="#a5adb3", lty=3)
}
panel(c(-4.5,2.5), "離台時からのバンク角変化 (°)", "実機の両IMUとモデル")
lines(imu$time, imu$main, col="#156b78", lwd=2)
lines(imu$time, imu$air, col="#ad5424", lwd=1.8, lty=2)
lines(model$time, model$simultaneous, col="#253050", lwd=2)
legend("bottomleft", c("主IMU","空力計側IMU","同時手放し"), col=c("#156b78","#ad5424","#253050"),
       lty=c(1,2,1), lwd=2, bg="white", box.col=NA, cex=.85)
left <- 1000*(model$leftFirst-model$simultaneous)
right <- 1000*(model$rightFirst-model$simultaneous)
panel(c(-2.4,2.4), "同時手放しからの差 (1目盛 = 0.001°)", "1コマ先に手を離したときの差")
lines(model$time, left, col="#056c7b", lwd=2.3)
lines(model$time, right, col="#ae4b22", lwd=2.3, lty=2)
legend("topright", c("左が先","右が先"), col=c("#056c7b","#ae4b22"),
       lty=c(1,2), lwd=2, bty="n", cex=.85)
invisible(dev.off())
