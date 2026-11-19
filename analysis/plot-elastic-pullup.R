# node analysis/elastic-pullup.js --csv | Rscript analysis/plot-elastic-pullup.R
d <- read.csv(file("stdin"))
observed <- subset(d, series == "log")
args <- commandArgs(trailingOnly=TRUE)
if (!length(args)) args <- c("elastic-previous", "elastic-revised", "docs/elastic-pullup.png")
stopifnot(length(args) == 3)
before <- subset(d, series == args[1])
after <- subset(d, series == args[2])
stopifnot(nrow(before) > 0, nrow(after) == nrow(before))
png(args[3], width=1440, height=990, res=150, bg="white")
par(family=if (Sys.info()[["sysname"]] == "Darwin") "Hiragino Sans" else "sans",
    mfrow=c(2,2), mar=c(3.5,4.6,2,1), oma=c(0,0,3,0), mgp=c(2.5,.7,0), las=1)
for (key in c("height","speed","pitchDeg","body")) {
  scale <- if (key == "body") 100 else 1
  limits <- range(c(before[[key]], after[[key]], observed[[key]]) * scale, na.rm=TRUE)
  label <- switch(key, height="計器高度 (m)", speed="ピトー対気速度 (m/s)",
                  pitchDeg="ピッチ (°)", body="身体位置・後方が正 (cm)")
  plot(c(0,10), limits, type="n", bty="l", xlab="離台後 (秒)", ylab=label)
  abline(h=axTicks(2), col="#dee6e9")
  lines(before$t, before[[key]] * scale, col="#79627c", lty=2, lwd=2)
  lines(after$t, after[[key]] * scale, col="#007574", lwd=2.8)
  if (key != "body") points(observed$t, observed[[key]], col="#843f0b", pch=16, cex=.6)
}
mtext("竜海　離台後10秒の引き起こし", side=3, outer=TRUE, line=1.7, font=2, cex=1.23)
mtext("● 大会ログ　　 破線　従来の操縦　　 実線　今回の操縦　　　両モデルとも弾性翼",
      side=3, outer=TRUE, line=.2, cex=.87)
invisible(dev.off())
