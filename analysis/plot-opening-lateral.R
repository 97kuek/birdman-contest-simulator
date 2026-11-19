d <- read.csv(file("stdin"))
imu <- subset(d,!is.na(main))
m <- subset(d,!is.na(base))
png("docs/tatsumi-opening-lateral.png",width=1480,height=720,res=144,bg="white")
par(mfrow=c(1,2),mar=c(4.1,4,2.1,.8),mgp=c(2.5,.7,0),las=1,
    family=if (Sys.info()[["sysname"]]=="Darwin") "Hiragino Sans" else "sans")
colors <- c("#155271","#ce681e","#838a96","#806591","#007c71")
for (period in list(c(0,2),c(2,10))) {
  early <- period[1]==0
  plot(period,if(early) c(-1.25,2.5) else c(-4.6,2.5),type="n",xaxs="i",bty="l",
       main=if(early) "離台から右に傾くまで" else "引き起こし後のロール",
       xlab="離台後の時間 (秒)",ylab="離台時からのバンク変化 (°)")
  abline(h=axTicks(2),col="#e0e6ea")
  abline(h=0,col="#a1a9b0")
  lines(imu$time,imu$main,lwd=2,col=colors[1])
  points(imu$time,imu$air,pch=16,cex=.44,col=colors[2])
  lines(m$time,m$base,lwd=1.8,lty=3,col=colors[3])
  lines(m$time,m$initial,lwd=2,lty=2,col=colors[4])
  lines(m$time,m$reconstructed,lwd=2.4,col=colors[5])
  if(!early) legend("topright",c("主IMU","空力計側IMU","従来モデル","初期横運動のみ","初期横運動＋翼の風の差"),
                     col=colors,pch=c(NA,16,NA,NA,NA),lty=c(1,0,3,2,1),lwd=2,
                     bg="white",box.col=NA,cex=.78)
}
invisible(dev.off())
