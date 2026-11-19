# Run at the repository root after generating the comparison CSV.
d <- read.csv("docs/pilot-shift-comparison.csv")
png("docs/pilot-shift-comparison.png", width=1440, height=900, res=155, bg="white")
par(family=if (Sys.info()[["sysname"]] == "Darwin") "Hiragino Sans" else "sans",
    mfrow=c(3,2), mar=c(2.5,4.3,1.0,0.9), oma=c(1,0,3.1,0),
    mgp=c(2.6,.7,0), las=1, fg="#506064", col.axis="#36484e")
log <- subset(d, version=="log")
old <- subset(d, version=="8d2e318" & control=="reference")
new <- subset(d, version=="current" & control=="reference")
teal <- "#00746a"; amber <- "#ab581b"
for (key in c("height_m","airspeed_m_s","pitch_deg")) {
  ylab <- switch(key,height_m="高さ (m)",airspeed_m_s="対気速度 (m/s)",pitch_deg="ピッチ (°)")
  ylim <- range(d[,key])
  panel <- function() {
    plot(c(0,10),ylim,type="n",ylim=ylim,xlab="",ylab=ylab,bty="l",xaxt="n")
    axis(1,at=seq(0,10,2))
    abline(h=axTicks(2),col="#e1e7e6",lwd=.7)
  }
  panel()
  lines(new$seconds,new[,key],col=teal,lwd=3.5)
  lines(old$seconds,old[,key],col=amber,lwd=1.3,lty=2)
  points(log$seconds,log[,key],col="#24383e",pch=16,cex=.48)
  if (key=="height_m") {
    title("大会ログと基準操縦",cex.main=1.05)
    legend("topright",c("大会ログ","旧版","更新後"),pch=c(16,NA,NA),lty=c(NA,2,1),
           col=c("#24383e",amber,teal),bty="n",cex=.68)
  }
  panel()
  rect(1.5,ylim[1],2.5,ylim[2],col="#e5eae9",border=NA)
  for (control in c("forward","aft")) {
    colour <- if (control=="aft") teal else amber
    for (version in c("8d2e318","current")) {
      rows <- d[d$control==control & d$version==version,]
      lines(rows$seconds,rows[,key],lwd=if (version=="current") 2 else 1.3,
            col=colour,lty=if (version=="current") 1 else 2)
    }
  }
  if (key=="height_m") {
    title("手動で1秒間だけ前・後に入力",cex.main=1.05)
    legend("topright",c("前・更新後","後・更新後","旧版は破線"),col=c(amber,teal,"#526465"),
           lty=c(1,1,2),bty="n",cex=.68)
  }
}
mtext("離台後の時間 (秒)",side=1,outer=TRUE,line=-.1,cex=.9)
mtext("竜海　離台後10秒の縦運動",side=3,outer=TRUE,line=1.25,font=2,cex=1.18)
invisible(dev.off())
