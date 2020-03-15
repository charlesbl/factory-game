import React from 'react';
import FactoryView from './FactoryView';

class GameView extends React.Component{
    render() {
        return (
            <div>
                <FactoryView factory={this.props.game.factory}/>
            </div>
        );
    }
}
export default GameView;