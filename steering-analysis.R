# Rscript steering-analysis.R 2025_Tatsumi.csv [steering-observations.png]
args <- commandArgs(trailingOnly=TRUE)
if (!length(args)) stop("Pass TORICA's 2025_Tatsumi.csv as the first argument.")
log <- read.csv(args[1], fileEncoding="UTF-8-BOM")
release <- 3.9
touch <- 58.130
log$t <- log$Time - release
air <- subset(log, Time >= release & Time <= touch)
fix <- log[c(TRUE, diff(log$Latitude) != 0 | diff(log$Longitude) != 0), ]
rad <- pi/180
latitude <- log$Latitude[1]*rad
ecc <- 0.00669437999014
d <- 1-ecc*sin(latitude)^2
fix$east <- (fix$Longitude-log$Longitude[1])*rad*6378137*cos(latitude)/sqrt(d)
fix$north <- (fix$Latitude-log$Latitude[1])*rad*6378137*(1-ecc)/d^1.5
position <- function(axis,t) approx(fix$t,fix[[axis]],t,rule=1)$y
course <- function(t,width=4) {
  chord <- function(axis) position(axis,t+width/2)-position(axis,t-width/2)
  (atan2(chord("east"),chord("north"))/rad+360) %% 360
}
angleDiff <- function(a,b) (a-b+180) %% 360-180
# Equal-duration centred chords at both ends of each interval; no held terminal fix.
epochs <- c(3,10,20,30,40,50)
intervals <- data.frame(start=head(epochs,-1),end=tail(epochs,-1))
rate <- function(start,end,width) angleDiff(course(end,width),course(start,width))/(end-start)
print(data.frame(t=epochs, bearing=course(epochs)),digits=5,row.names=FALSE)
for (width in c(2,4,6)) {
  intervals[[paste0("deg_s_",width,"s")]] <- rate(intervals$start,intervals$end,width)
}
print(intervals,digits=3,row.names=FALSE)
print(table(air$Rudder))
print(subset(air,abs(Rudder)>1,select=c(t,Rudder,Roll,Yaw,AoS)))
gpsTimes <- subset(fix,t>=0 & Time<=touch)$t
print(summary(diff(gpsTimes)))
cat("Last fix t:",tail(gpsTimes,1),"s. IMU median dt:",median(diff(air$t)),"s.\n")
print(sapply(air[c("Roll","Yaw","AoS")],range))
for (t in c(30,40,50)) {
  cat("t =",t,"signed 4s chord change vs t=3:",angleDiff(course(t),course(3)),"deg\n")
}
if (length(args)>1) {
  png(args[2],width=1440,height=900,res=145,bg="white")
  par(family=if(Sys.info()[["sysname"]]=="Darwin") "Hiragino Sans" else "sans",mar=c(3.1,4.3,1.8,1.2),mgp=c(2.2,.65,0),las=1)
  layout(matrix(c(1,2,3,3),nrow=2,byrow=TRUE),widths=c(1,1.2))
  navy <- "#175663"; amber <- "#a64c15"
  route <- subset(fix,t>=0 & Time<=touch)
  x <- c(0,route$east-position("east",0))
  y <- c(0,route$north-position("north",0))
  plot(x,y,type="l",asp=1,col=navy,lwd=2,xlab="東方向の距離 (m)",ylab="北方向の距離 (m)",
       main="離台点からの GPS 航跡",xlim=range(x)+c(-15,15))
  for (t in c(0,20,40,50)) {
    px <- position("east",t)-position("east",0); py <- position("north",t)-position("north",0)
    points(px,py,pch=16,cex=.7,col=navy)
    text(px,py,paste(t,"s"),pos=if(t==0) 2 else 3,cex=.74)
  }
  t <- seq(2,51.8,.2)
  plot(t,course(t),type="l",lwd=2,col=navy,xlim=c(0,55),ylim=c(215,330),
       main="GPS 対地方位（前後 2 秒の変位）",xlab="離台後の時間 (s)",ylab="方位 (°)")
  points(epochs,course(epochs),pch=16,col=navy,cex=.7)
  valid <- ifelse(abs(air$Rudder)<=20,air$Rudder,NA)
  plot(air$t,air$Roll,type="l",col=navy,lwd=1.5,xlim=c(0,55),ylim=c(-4,8),
       main="機体の傾きとラダー系統の記録",xlab="離台後の時間 (s)",ylab="角度 (°)")
  abline(h=0,col="gray80",lty=2)
  lines(air$t,valid,col=amber,lwd=1)
  points(air$t[abs(air$Rudder)>20],rep(7.5,sum(abs(air$Rudder)>20)),pch=4,col=amber)
  legend("topleft",c("IMU ロール","ICS 換算角","設計範囲外の記録時刻"),col=c(navy,amber,amber),
         lty=c(1,1,NA),pch=c(NA,NA,4),bty="n",cex=.72)
  invisible(dev.off())
}
