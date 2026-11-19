# node analysis/release-loads.js path/to/2025_Tatsumi.csv --offsets-csv | Rscript analysis/plot-release-offset.R
d <- read.csv(file("stdin"))
png("docs/tatsumi-release-offset.png", width=1380, height=640, res=140, bg="white")
par(mfrow=c(1,2), mar=c(4,4,2.5,1), mgp=c(2.5,.7,0), las=1,
    family=if (Sys.info()[["sysname"]] == "Darwin") "Hiragino Sans" else "sans")
panel <- function(ys, label, title, limits=range(ys)) {
  plot(d$origin, ys, type="n", bty="l", xlab="離台と置いた機上時刻 (秒)",
       ylim=limits, ylab=label, main=title, cex.main=1)
  abline(h=axTicks(2), col="#e2e8ee")
  abline(v=3.9, col="#909da1", lty=3)
}
panel(d$gap, "モデル − 主IMU (°/s)", "身体固定・離台0.75秒後の機首下げ")
abline(h=0, col="#7d878d", lty=2)
lines(d$origin, d$gap, col="#076e70", lwd=2.1, type="o", pch=16, cex=.45)
points(d$origin[d$origin %in% c(3.9,3.98)], d$gap[d$origin %in% c(3.9,3.98)], pch=21, bg="#f7b04c", cex=1.15)
panel(d$early, "ピッチRMSE (°)", "同じ時刻合わせでの基準操縦", range(d$early,d$mid,d$late))
cols <- c("#aa5522","#076e70","#504189")
lines(d$origin,d$early,col=cols[1],lwd=2)
lines(d$origin,d$mid,col=cols[2],lwd=2,lty=2)
lines(d$origin,d$late,col=cols[3],lwd=2,lty=3)
legend("topleft", c("0.50〜1.25秒","2〜5秒","5〜10秒"), col=cols,lty=1:3,lwd=2,bty="n",cex=.77)
invisible(dev.off())
