pico-8 cartridge // http://www.pico-8.com
version 42
__lua__
-- official-runtime audio/status capture probe
-- output: audio_status.csv and p8_audio_runtime.wav

local update_no=0
local status_file="audio_status.csv"

function write_status()
 local row=tostr(update_no)
 for i=46,57 do
  row..=","..tostr(stat(i),true)
 end
 printh(row,status_file)
end

function _init()
 local header="update"
 for i=46,57 do
  header..=",stat"..i
 end
 printh(header,status_file,true)
 extcmd("set_filename","p8_audio_runtime")
 extcmd("audio_rec")
 music(0)
end

function _update60()
 update_no+=1

 -- filtered looping sound on an explicitly reserved channel
 if update_no==10 then sfx(1,3) end

 -- release the loop and let it finish naturally
 if update_no==40 then sfx(-2,3) end

 -- prove that live copies into the sfx ram are audible
 if update_no==70 then
  memcpy(0x3288,0x3200,68)
  sfx(2,2)
 end

 -- exercise music fade/status transitions
 if update_no==90 then music(-1,500) end

 write_status()

 if update_no==150 then
  extcmd("audio_end",1)
  stop("audio capture complete")
 end
end

function _draw()
 cls()
 print("audio oracle capture",23,54,7)
 print(update_no.." / 150",45,66,6)
end
__sfx__
0008000018070191711a2721b3731c4741d5751e6761f777000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
6e0800042057021570225702357020570215702257023570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
__music__
00 00414243
