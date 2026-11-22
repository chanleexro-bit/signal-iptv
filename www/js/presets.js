// Public iptv-org lists: links to freely available broadcasts.
const IO = 'https://iptv-org.github.io/iptv/';
export const PRESETS = [
  { group: 'By category', items: [
    ['News', IO + 'categories/news.m3u'], ['Sports', IO + 'categories/sports.m3u'], ['Movies', IO + 'categories/movies.m3u'],
    ['Music', IO + 'categories/music.m3u'], ['Kids', IO + 'categories/kids.m3u'], ['Documentary', IO + 'categories/documentary.m3u'],
    ['Entertainment', IO + 'categories/entertainment.m3u']] },
  { group: 'By country', items: [
    ['United States', IO + 'countries/us.m3u'], ['Canada', IO + 'countries/ca.m3u'], ['United Kingdom', IO + 'countries/uk.m3u'],
    ['Australia', IO + 'countries/au.m3u'], ['India', IO + 'countries/in.m3u']] },
  { group: 'By language', items: [
    ['English', IO + 'languages/eng.m3u'], ['Spanish', IO + 'languages/spa.m3u'], ['French', IO + 'languages/fra.m3u']] }
];
export const COUNTRY_GUIDES = [
  ['United States', 'https://epgshare01.online/epgshare01/epg_ripper_US2.xml.gz'],
  ['Canada', 'https://epgshare01.online/epgshare01/epg_ripper_CA2.xml.gz'],
  ['United Kingdom', 'https://epgshare01.online/epgshare01/epg_ripper_UK1.xml.gz'],
  ['Australia', 'https://epgshare01.online/epgshare01/epg_ripper_AU1.xml.gz'],
  ['India', 'https://epgshare01.online/epgshare01/epg_ripper_IN1.xml.gz'],
  ['US sports', 'https://epgshare01.online/epgshare01/epg_ripper_US_SPORTS1.xml.gz']
];
