#!/usr/bin/perl

use strict;

foreach my $path (@ARGV) {
    open (my $IN, "<$path") or die "$path: $!";
    my %ids = ();
    my @toc = ();
    my $content = "";

    my $lastDepth = 0;
    while (<$IN>) {
        if (m/^(\#{2,})(.*?)<span id="([\w-.]+)"><\/span>\s*$/) {
            my $depth = length($1) - 1;
            my $text = $2;
            my $id = $3;
            if (exists($ids{$id})) {
                die "$path:$.: Heading id $id previously seen at $ids{$id}";
            } else {
                $ids{$id} = $.;
            }
            if ($depth > $lastDepth + 1) {
                die "$path:$.: Heading id $id has depth $depth which skips levels from $lastDepth";
            }
            $text =~ s/^\s*|\s*$//g;
            push(@toc, ("   " x ($depth - 1)) . "*  [$text](#$id)\n");
            $lastDepth = $depth;
        } elsif (m/^##/) {
            die "$path:$.: Heading lacks identifier";
        }
        $content .= $_;
    }

    close ($IN) or die "$path: $!";

    my $toc = join("", @toc);
    unless ($content =~ s/(\n<!-- TOC -->\n).*?(\n<!-- \/TOC -->\n)/$1\n$toc$2/s) {
        die "$path: Cannot find <!-- TOC --> delimited space for the table of contents";
    }

    my $outpath = "$path.out";
    open (my $OUT, ">$outpath") or die "$path: $!";
    print $OUT "$content";
    close ($OUT) or die "$path: $!";

    rename($outpath, $path) or die "$path: Failed to rename $outpath to $path  $!";
}
