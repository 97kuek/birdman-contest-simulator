# node analysis/elastic-flight.js --csv | Rscript analysis/plot-elastic-flight.R
d <- read.csv(file("stdin"))
png("docs/elastic-flight.png", width=1450, height=875, res=145)
par(mfrow=c(2, 2), mar=c(3.3, 3.9, 2.6, 0.8), mgp=c(2.2,.65,0),
    las=1, bty="l", fg="#43546a", col.axis="#43546a", col.lab="#172e45")
for (id in c("ryukai","qx25")) {
  rows <- subset(d, aircraft == id)
  for (gust in c(FALSE, TRUE)) {
    a <- subset(rows, scenario == if (gust) "gust" else "pullup")
    b <- if (gust) a$rightTip else subset(rows, scenario == "neutral")$leftTip
    title <- paste(if (id == "qx25") "QX-25" else "Tatsumi", if (gust) " / gust field" else " / pull-up")
    plot(a$seconds, a$leftTip, type="n", xlim=c(0,10), ylim=range(0,rows$leftTip,rows$rightTip)*1.12,
         xlab="Seconds after release", ylab="Wingtip deflection (m)", main=title)
    if (!gust) rect(2, par("usr")[3], 2.55, par("usr")[4], border=NA, col="#f5e9d2")
    grid(col="#dfe7ed", lty=1)
    lines(a$seconds, a$leftTip, lwd=2.4, col="#007e84")
    lines(a$seconds, b, lwd=1.8, col="#97432e", lty=2)
    legend("bottomright", if (gust) c("Left wing","Right wing") else c("Pull-up","No input"),
           col=c("#007e84","#97432e"), lty=c(1,2), lwd=2, bty="n", cex=.8)
  }
}
invisible(dev.off())
