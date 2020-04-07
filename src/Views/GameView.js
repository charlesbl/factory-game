import React from 'react';
import FactoryView from './FactoryView';

class GameView extends React.Component {
    render() {
        return (
            <FactoryView game={this.props.game} />
        );
    }
}
export default GameView;