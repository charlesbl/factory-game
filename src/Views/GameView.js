import React from 'react';
import FactoryView from './FactoryView';

class GameView extends React.Component {
    constructor(props) {
        super(props);
    }

    render() {
        return (
            <FactoryView factory={this.props.game.factories[0]} />
        );
    }
}
export default GameView;