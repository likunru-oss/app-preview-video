import {Composition} from 'remotion';
import {AppPreview, schema, totalFrames, type Props} from './AppPreview';
import settings from './settings.json';

// App Store 预览视频：6.9" iPhone 竖屏 886x1920，30fps；总时长 = 各页时长之和
// 所有可调内容都存在 src/settings.json 里，由控制台（control/）读写
export const Root = () => (
  <Composition
    id="AppPreview"
    component={AppPreview}
    durationInFrames={720}
    fps={30}
    width={886}
    height={1920}
    schema={schema}
    calculateMetadata={({props}) => ({durationInFrames: totalFrames(props)})}
    defaultProps={settings as Props}
  />
);
